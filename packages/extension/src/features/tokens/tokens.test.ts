import {
  HttpScanClient,
  NETWORKS,
  RestChainClient,
  type DenomBranding,
  type HttpTransport,
  type NetworkId,
  type TokenInfo,
} from '@beepocket/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerHandlers } from '../../background/handlers';
import type { DappService } from '../../dapp';
import type { AddTokenService } from '../addtoken';
import { HandlerRegistry } from '../../background/registry';
import type { Services } from '../../background/services';
import type { Platform } from '../../platform';
import { registerTokenHandlers } from './handlers';
import type { WalletService } from '../wallet';
import type { PreferredTokensStore, WalletAddress, WalletAddresses } from './ports';
import { ok, WalletErrorCodes, type TokenSearch } from '../../protocol';

const FACTORY = 'factory/bze1abc/gold';
const IBC = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2';
const BRANDING: DenomBranding = {
  font: 'inter',
  light: { background: '#FFFFFF', text: '#111111', primary: '#CC8800', secondary: '#888888' },
  dark: { background: '#000000', text: '#EEEEEE', primary: '#FFB000', secondary: '#777777' },
};

interface Chain {
  supplies: Record<string, bigint>;
  metadata: Record<string, { symbol: string; name: string; exponent: number }>;
  branding: Record<string, DenomBranding>;
  balances: Record<string, Map<string, bigint>>;
  balanceCalls: string[];
  supplyCalls: string[];
  /** Denoms whose metadata query fails like an unreachable node. */
  broken: Set<string>;
  /** Addresses whose balance query fails. */
  brokenAddresses: Set<string>;
}

const GOLD_LOGO =
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/beezee/images/gold.png';
const SCAN_LOGOS: Record<string, string> = {
  [FACTORY]: GOLD_LOGO,
  ubze: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/beezee/images/bze.png',
};

function setup(
  opts: { addresses?: WalletAddress[]; scanDown?: boolean; preferred?: string[] } = {},
) {
  const freshChain = (): Chain => ({
    supplies: { ubze: 10n, [FACTORY]: 5n, [IBC]: 5n },
    metadata: { [FACTORY]: { symbol: 'GOLD', name: 'Gold Coin', exponent: 6 } },
    branding: { [FACTORY]: BRANDING },
    balances: {},
    balanceCalls: [],
    supplyCalls: [],
    broken: new Set(),
    brokenAddresses: new Set(),
  });
  const datas: Record<NetworkId, Chain> = { mainnet: freshChain(), testnet: freshChain() };
  const chainData = datas.mainnet;
  const chain = (id: NetworkId) => {
    const data = datas[id];
    return {
      supply: (d: string) => {
        data.supplyCalls.push(d);
        return Promise.resolve(data.supplies[d] ?? 0n);
      },
      denomMetadata: (d: string) =>
        data.broken.has(d)
          ? Promise.reject(new Error('node down'))
          : Promise.resolve(data.metadata[d] ?? null),
      denomBranding: (d: string) => Promise.resolve(data.branding[d] ?? null),
      balances: (a: string) => {
        data.balanceCalls.push(`${id}:${a}`);
        return data.brokenAddresses.has(a)
          ? Promise.reject(new Error('node down'))
          : Promise.resolve(data.balances[a] ?? new Map<string, bigint>());
      },
    };
  };
  const scanCalls: string[] = [];
  let scanDown = opts.scanDown ?? false;
  const scan = {
    token: (d: string) => {
      scanCalls.push(d);
      return scanDown
        ? Promise.reject(new Error('scan down'))
        : Promise.resolve({
            denom: d,
            symbol: 'ATOM',
            name: 'Cosmos Hub',
            exponent: 6,
            kind: 'ibc',
            halted: false,
          });
    },
    // Scan lists a GitHub logo for GOLD and, wrongly, a remote one for ubze.
    asset: (d: string) =>
      scanDown
        ? Promise.reject(new Error('scan down'))
        : Promise.resolve({ denom: d, logo: SCAN_LOGOS[d] ?? null }),
  };

  let active: NetworkId = 'mainnet';
  const services = {
    activeNetwork: () => Promise.resolve(NETWORKS[active]),
    clients: () => Promise.resolve({ network: NETWORKS[active], chain: chain(active), scan }),
  } as unknown as Services;

  const kv = () => {
    const m = new Map<string, unknown>();
    return {
      m,
      get: (k: string) => Promise.resolve(m.get(k)),
      set: (k: string, v: unknown) => Promise.resolve(void m.set(k, v)),
      remove: (k: string) => Promise.resolve(void m.delete(k)),
    };
  };
  const session = kv();
  const cacheMap = new Map<string, unknown>();
  let now = 1_000_000;
  const platform = {
    storage: kv(),
    session,
    clock: { now: () => now },
    cache: {
      get: (k: string) => Promise.resolve(cacheMap.get(k)),
      set: (k: string, v: unknown) => Promise.resolve(void cacheMap.set(k, v)),
    },
  } as unknown as Platform;

  const prefs = new Map<string, string[]>();
  if (opts.preferred) prefs.set('mainnet', opts.preferred);
  const preferred: PreferredTokensStore = {
    get: (n) => Promise.resolve([...(prefs.get(n) ?? [])]),
    set: (n, d) => {
      prefs.set(n, [...d]);
      return Promise.resolve(ok(null));
    },
  };
  const addresses: WalletAddresses = {
    list: () => Promise.resolve(opts.addresses ?? []),
  };

  const registry = new HandlerRegistry();
  registerTokenHandlers(registry, { platform, services }, { preferred, addresses });
  // The type parameter only types the (already validated) reply for the assertions.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  const call = <T = unknown>(method: string, payload: unknown = {}) =>
    registry.dispatch({ method, payload }) as Promise<
      { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
    >;
  return {
    call,
    chainData,
    testnetData: datas.testnet,
    setScanDown: (down: boolean) => (scanDown = down),
    scanCalls,
    prefs,
    cacheMap,
    session,
    advance: (ms: number) => (now += ms),
    useNetwork: (n: NetworkId) => (active = n),
  };
}

const ADDRS: WalletAddress[] = [
  { index: 0, address: 'bze1a' },
  { index: 1, address: 'bze1b' },
];

describe('tokens.lookup', () => {
  it('answers ubze from the built-in data without asking the chain for supply', async () => {
    const t = setup();
    const r = await t.call<TokenInfo>('tokens.lookup', { code: 'ubze' });
    expect(t.chainData.supplyCalls).toEqual([]);
    expect(r).toMatchObject({ ok: true, value: { denom: 'ubze', symbol: 'BZE', decimals: 6 } });
  });

  it('returns a factory token with metadata and branding', async () => {
    const r = await setup().call<TokenInfo>('tokens.lookup', { code: FACTORY });
    expect(r).toMatchObject({
      ok: true,
      value: {
        symbol: 'GOLD',
        name: 'Gold Coin',
        decimals: 6,
        source: 'chain',
        branding: BRANDING,
      },
    });
  });

  it('falls back to a guess for a factory token without metadata, with null branding', async () => {
    const t = setup();
    t.chainData.metadata = {};
    t.chainData.branding = {};
    const r = await t.call<TokenInfo>('tokens.lookup', { code: FACTORY });
    expect(r).toMatchObject({
      ok: true,
      value: { symbol: 'GOLD', source: 'fallback', branding: null },
    });
  });

  it('gives BZE the logo shipped with the extension and other tokens the Scan logo', async () => {
    const t = setup();
    expect(await t.call<TokenInfo>('tokens.lookup', { code: 'ubze' })).toMatchObject({
      ok: true,
      value: { logo: '/tokens/bze.png' },
    });
    expect(await t.call<TokenInfo>('tokens.lookup', { code: FACTORY })).toMatchObject({
      ok: true,
      value: { symbol: 'GOLD', logo: GOLD_LOGO },
    });
  });

  it('still resolves a token without its logo while Scan is down', async () => {
    const t = setup({ scanDown: true });
    expect(await t.call<TokenInfo>('tokens.lookup', { code: FACTORY })).toMatchObject({
      ok: true,
      value: { symbol: 'GOLD', logo: null },
    });
  });

  it('reads IBC tokens from Scan and caches them', async () => {
    const t = setup();
    const first = await t.call<TokenInfo>('tokens.lookup', { code: IBC });
    expect(first).toMatchObject({ ok: true, value: { symbol: 'ATOM', source: 'scan' } });
    await t.call('tokens.lookup', { code: IBC });
    expect(t.scanCalls).toHaveLength(1);
  });

  it('degrades to the fallback when Scan is down, and does not cache that', async () => {
    const t = setup({ scanDown: true });
    const r = await t.call<TokenInfo>('tokens.lookup', { code: IBC });
    expect(r).toMatchObject({ ok: true, value: { source: 'fallback' } });
    await t.call('tokens.lookup', { code: IBC });
    expect(t.scanCalls).toHaveLength(2);
  });

  it('keeps answering an IBC token from the cache when Scan goes down', async () => {
    const t = setup();
    await t.call('tokens.lookup', { code: IBC });
    t.setScanDown(true);
    const r = await t.call<TokenInfo>('tokens.lookup', { code: IBC });
    expect(r).toMatchObject({ ok: true, value: { symbol: 'ATOM', source: 'scan' } });
  });

  it('answers no-such-token for a denom without supply', async () => {
    const r = await setup().call('tokens.lookup', { code: 'factory/bze1abc/ghost' });
    expect(r).toEqual({
      ok: false,
      error: { code: 'no-such-token', message: 'No token with this denom on BeeZee' },
    });
  });

  it('answers invalid-code for something no chain could hold', async () => {
    const r = await setup().call('tokens.lookup', { code: 'not a denom!' });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid-code' } });
  });

  it('rejects a non-string code as a bad request', async () => {
    const r = await setup().call('tokens.lookup', { code: 5 });
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } });
  });
});

describe('preferred tokens', () => {
  it('lists the picks in order, with branding, and nothing else', async () => {
    const t = setup({ preferred: [FACTORY, 'ubze'] });
    const r = await t.call<TokenInfo[]>('tokens.preferred');
    expect(r.ok && r.value.map((x) => x.denom)).toEqual([FACTORY, 'ubze']);
    expect(r.ok && r.value[0]?.branding).toEqual(BRANDING);
  });

  it('appends on add and ignores duplicates', async () => {
    const t = setup({ preferred: ['ubze'] });
    await t.call('tokens.add', { denom: FACTORY });
    const again = await t.call<TokenInfo[]>('tokens.add', { denom: FACTORY });
    expect(again.ok && again.value.map((x) => x.denom)).toEqual(['ubze', FACTORY]);
    expect(t.prefs.get('mainnet')).toEqual(['ubze', FACTORY]);
  });

  it('refuses to add an unknown or invalid denom', async () => {
    const t = setup({ preferred: ['ubze'] });
    expect(await t.call('tokens.add', { denom: 'factory/bze1abc/ghost' })).toMatchObject({
      ok: false,
      error: { code: 'no-such-token' },
    });
    expect(await t.call('tokens.add', { denom: '??' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-code' },
    });
    expect(t.prefs.get('mainnet')).toEqual(['ubze']);
  });

  it('removes a token but never the last one', async () => {
    const t = setup({ preferred: ['ubze', FACTORY] });
    const removed = await t.call<TokenInfo[]>('tokens.remove', { denom: 'ubze' });
    expect(removed.ok && removed.value.map((x) => x.denom)).toEqual([FACTORY]);
    expect(await t.call('tokens.remove', { denom: FACTORY })).toMatchObject({
      ok: false,
      error: { code: 'last-token' },
    });
    expect(t.prefs.get('mainnet')).toEqual([FACTORY]);
  });

  it('keeps the lists of the two networks apart', async () => {
    const t = setup({ preferred: ['ubze'] });
    t.useNetwork('testnet');
    const r = await t.call<TokenInfo[]>('tokens.preferred');
    expect(r).toEqual({ ok: true, value: [] });
  });
});

describe('tokens.balances', () => {
  function withBalances() {
    const t = setup({ addresses: ADDRS });
    t.chainData.balances.bze1a = new Map([
      ['ubze', 5n],
      [FACTORY, 7n],
    ]);
    t.chainData.balances.bze1b = new Map([['ubze', 2n]]);
    return t;
  }

  it('lists the amount per address and the total as decimal strings', async () => {
    const r = await withBalances().call('tokens.balances', { denom: 'ubze' });
    expect(r).toEqual({
      ok: true,
      value: {
        denom: 'ubze',
        addresses: [
          { index: 0, address: 'bze1a', amount: '5' },
          { index: 1, address: 'bze1b', amount: '2' },
        ],
        total: '7',
        partial: false,
      },
    });
  });

  it('is zero for a denom the addresses do not hold', async () => {
    const r = await withBalances().call('tokens.balances', { denom: IBC });
    expect(r).toMatchObject({ ok: true, value: { total: '0' } });
  });

  it('answers an empty list before any address exists', async () => {
    const r = await setup().call('tokens.balances', { denom: 'ubze' });
    expect(r).toEqual({
      ok: true,
      value: { denom: 'ubze', addresses: [], total: '0', partial: false },
    });
  });

  it('reuses a read for 3 s, under the 4 s poll, refreshes after, and on demand', async () => {
    const t = withBalances();
    await t.call('tokens.balances', { denom: 'ubze' });
    await t.call('tokens.balances', { denom: FACTORY });
    expect(t.chainData.balanceCalls).toHaveLength(2);
    t.advance(2_999);
    await t.call('tokens.balances', { denom: 'ubze' });
    expect(t.chainData.balanceCalls).toHaveLength(2);
    t.advance(1);
    await t.call('tokens.balances', { denom: 'ubze' });
    expect(t.chainData.balanceCalls).toHaveLength(4);
    await t.call('tokens.balances', { denom: 'ubze', refresh: true });
    expect(t.chainData.balanceCalls).toHaveLength(6);
  });

  it('answers the last read of every address, however old, without asking the node', async () => {
    const t = withBalances();
    expect(await t.call('tokens.lastBalances', { denom: 'ubze' })).toEqual({
      ok: true,
      value: null,
    });
    await t.call('tokens.balances', { denom: 'ubze' });
    t.chainData.balances.bze1a = new Map([['ubze', 50n]]);
    t.advance(3_600_000);
    expect(await t.call('tokens.lastBalances', { denom: FACTORY })).toEqual({
      ok: true,
      value: {
        denom: FACTORY,
        addresses: [
          { index: 0, address: 'bze1a', amount: '7' },
          { index: 1, address: 'bze1b', amount: '0' },
        ],
        total: '7',
        partial: false,
      },
    });
    expect(t.chainData.balanceCalls).toHaveLength(2);
  });

  it('answers null for last balances while some address was never read', async () => {
    const t = withBalances();
    t.chainData.brokenAddresses.add('bze1b');
    await t.call('tokens.balances', { denom: 'ubze' });
    expect(await t.call('tokens.lastBalances', { denom: 'ubze' })).toEqual({
      ok: true,
      value: null,
    });
  });

  it('rejects a non-boolean refresh', async () => {
    const r = await withBalances().call('tokens.balances', { denom: 'ubze', refresh: 'yes' });
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } });
  });

  it("does not show one network's balances on the other", async () => {
    const t = withBalances();
    t.testnetData.balances.bze1a = new Map([['ubze', 100n]]);
    await t.call('tokens.balances', { denom: 'ubze' });
    t.useNetwork('testnet');
    const r = await t.call('tokens.balances', { denom: 'ubze' });
    expect(r).toMatchObject({ ok: true, value: { total: '100' } });
    t.useNetwork('mainnet');
    expect(await t.call('tokens.balances', { denom: 'ubze' })).toMatchObject({
      value: { total: '7' },
    });
  });

  it("does not show one network's token data on the other", async () => {
    const t = setup();
    t.testnetData.supplies = { ubze: 10n };
    expect(await t.call('tokens.lookup', { code: FACTORY })).toMatchObject({ ok: true });
    t.useNetwork('testnet');
    expect(await t.call('tokens.lookup', { code: FACTORY })).toMatchObject({
      ok: false,
      error: { code: 'no-such-token' },
    });
  });

  it('reports an unreadable address as failed and the total as partial', async () => {
    const t = withBalances();
    t.chainData.brokenAddresses.add('bze1b');
    const r = await t.call('tokens.balances', { denom: 'ubze' });
    expect(r).toEqual({
      ok: true,
      value: {
        denom: 'ubze',
        addresses: [
          { index: 0, address: 'bze1a', amount: '5' },
          { index: 1, address: 'bze1b', amount: '0', failed: true },
        ],
        total: '5',
        partial: true,
      },
    });
  });

  it('is not complete-looking: a clean read is not partial', async () => {
    const r = await withBalances().call('tokens.balances', { denom: 'ubze' });
    expect(r).toMatchObject({ value: { partial: false } });
  });

  it('treats a denom named like an object property as plain zero', async () => {
    for (const denom of ['constructor', 'toString', '__proto__']) {
      const r = await withBalances().call('tokens.balances', { denom });
      expect(r).toMatchObject({ ok: true, value: { total: '0', partial: false } });
    }
  });

  it('adds up many held denoms (a large paginated node answer)', async () => {
    const t = setup({ addresses: ADDRS });
    const many = new Map<string, bigint>();
    for (let i = 0; i < 500; i++) many.set(`factory/bze1abc/t${String(i)}`, 1n);
    many.set('ubze', 9n);
    t.chainData.balances.bze1a = many;
    const r = await t.call('tokens.balances', { denom: 'factory/bze1abc/t499' });
    expect(r).toMatchObject({ ok: true, value: { total: '1' } });
  });
});

describe('tokens.search', () => {
  it('offers ubze alone before any address exists', async () => {
    const r = await setup().call<TokenSearch>('tokens.search', { query: '' });
    expect(r.ok && r.value.tokens.map((x) => x.denom)).toEqual(['ubze']);
  });

  it('matches symbol, name and denom case-insensitively over held tokens', async () => {
    const t = setup({ addresses: ADDRS });
    t.chainData.balances.bze1a = new Map([
      [FACTORY, 7n],
      [IBC, 0n],
    ]);
    const bySymbol = await t.call<TokenSearch>('tokens.search', { query: 'gOlD' });
    expect(bySymbol.ok && bySymbol.value.tokens.map((x) => x.denom)).toEqual([FACTORY]);
    const byName = await t.call<TokenSearch>('tokens.search', { query: 'beezee' });
    expect(byName.ok && byName.value.tokens.map((x) => x.denom)).toEqual(['ubze']);
    const byDenom = await t.call<TokenSearch>('tokens.search', { query: 'BZE1ABC' });
    expect(byDenom.ok && byDenom.value.tokens.map((x) => x.denom)).toEqual([FACTORY]);
    const zero = await t.call<TokenSearch>('tokens.search', { query: 'atom' });
    expect(zero).toEqual({ ok: true, value: { tokens: [], partial: false } });
  });
});

describe('tokens.search limits', () => {
  it('finds a held denom beyond the first hundred', async () => {
    const t = setup({ addresses: ADDRS });
    const many = new Map<string, bigint>();
    for (let i = 0; i < 250; i++) many.set(`factory/bze1abc/t${String(i)}`, 1n);
    t.chainData.balances.bze1a = many;
    const r = await t.call<TokenSearch>('tokens.search', { query: 't249' });
    expect(r.ok && r.value.tokens.map((x) => x.denom)).toEqual(['factory/bze1abc/t249']);
  });

  it('caps only the answer', async () => {
    const t = setup({ addresses: ADDRS });
    const many = new Map<string, bigint>();
    for (let i = 0; i < 250; i++) many.set(`factory/bze1abc/t${String(i)}`, 1n);
    t.chainData.balances.bze1a = many;
    const r = await t.call<TokenSearch>('tokens.search', { query: 'bze1abc' });
    expect(r.ok && r.value.tokens.length).toBe(100);
  });

  it('degrades to ubze when no address can be read, and says so', async () => {
    const t = setup({ addresses: ADDRS });
    t.chainData.brokenAddresses.add('bze1a').add('bze1b');
    const r = await t.call<TokenSearch>('tokens.search', { query: '' });
    expect(r).toEqual({
      ok: true,
      value: { tokens: [expect.objectContaining({ denom: 'ubze' })], partial: true },
    });
  });

  it('lists what the readable addresses hold when one fails, marked partial', async () => {
    const t = setup({ addresses: ADDRS });
    t.chainData.balances.bze1a = new Map([[FACTORY, 7n]]);
    t.chainData.brokenAddresses.add('bze1b');
    const r = await t.call<TokenSearch>('tokens.search', { query: '' });
    expect(r.ok && r.value.tokens.map((x) => x.denom)).toEqual(['ubze', FACTORY]);
    expect(r.ok && r.value.partial).toBe(true);
  });

  it('is not partial when every address was read', async () => {
    const t = setup({ addresses: ADDRS });
    t.chainData.balances.bze1a = new Map([[FACTORY, 7n]]);
    const r = await t.call<TokenSearch>('tokens.search', { query: '' });
    expect(r.ok && r.value.partial).toBe(false);
  });
});

describe('tokens.preferred when the node fails', () => {
  it('keeps every picked denom, flagging the one it could not resolve', async () => {
    const t = setup({ preferred: ['ubze', FACTORY, IBC] });
    t.chainData.broken.add(FACTORY);
    const r = await t.call<(TokenInfo & { unresolved?: boolean })[]>('tokens.preferred');
    expect(r.ok && r.value.map((x) => x.denom)).toEqual(['ubze', FACTORY, IBC]);
    expect(r.ok && r.value[1]).toMatchObject({
      symbol: 'GOLD',
      kind: 'factory',
      source: 'fallback',
      branding: null,
      unresolved: true,
    });
    expect(r.ok && r.value[0]).not.toHaveProperty('unresolved');
  });
});

describe('tokens.theme', () => {
  it('returns the on-chain brand palette', async () => {
    expect(await setup().call('tokens.theme', { denom: FACTORY })).toEqual({
      ok: true,
      value: BRANDING,
    });
  });

  it('returns null for a token without branding and for ubze', async () => {
    const t = setup();
    expect(await t.call('tokens.theme', { denom: IBC })).toEqual({ ok: true, value: null });
    expect(await t.call('tokens.theme', { denom: 'ubze' })).toEqual({ ok: true, value: null });
    expect(t.chainData.supplyCalls).not.toContain('ubze');
  });
});

describe('wired to the wallet profile', () => {
  const ADDR = 'bze1a';
  /** `weak`: the profile is readable but there is no key to re-seal it (weak lock). */
  function wired(state: 'unlocked' | 'weak' | 'locked', preferred = ['ubze']) {
    let profile = {
      addresses: [{ index: 0, label: 'Main', address: ADDR }],
      preferredTokens: { mainnet: [...preferred], testnet: ['ubze'] },
    };
    const readable = state !== 'locked';
    const locked = { ok: false, error: { code: WalletErrorCodes.locked, message: 'locked' } };
    const wallet = {
      getProfile: () => Promise.resolve(readable ? { ok: true, value: profile } : locked),
      addresses: () =>
        Promise.resolve(readable ? { ok: true, value: { addresses: profile.addresses } } : locked),
      updateProfile: (patch: (p: typeof profile) => typeof profile) => {
        if (state === 'locked') return Promise.resolve(locked);
        if (state === 'weak') {
          return Promise.resolve({
            ok: false,
            error: { code: WalletErrorCodes.needsPassword, message: 'Enter your password.' },
          });
        }
        profile = patch(structuredClone(profile));
        return Promise.resolve({ ok: true, value: profile });
      },
    };
    const writes: string[] = [];
    const registry = new HandlerRegistry();
    registerHandlers(registry, {
      platform: {
        storage: { set: (k: string) => Promise.resolve(void writes.push(k)) },
        session: {
          get: () => Promise.resolve(undefined),
          set: () => Promise.resolve(),
        },
        clock: { now: () => 1 },
        cache: { get: () => Promise.resolve(undefined), set: () => Promise.resolve() },
      } as unknown as Platform,
      services: {
        clients: () =>
          Promise.resolve({
            network: NETWORKS.mainnet,
            chain: {
              supply: () => Promise.resolve(1n),
              denomMetadata: () => Promise.resolve(null),
              denomBranding: () => Promise.resolve(null),
              balances: () => Promise.resolve(new Map([['ubze', 3n]])),
            },
            scan: {},
          }),
      } as unknown as Services,
      wallet: wallet as unknown as WalletService,
      dapp: {} as unknown as DappService,
      addToken: {} as unknown as AddTokenService,
    });
    return { registry, writes, profile: () => profile };
  }

  it('keeps the preferred list in the profile of the active network, not in plain storage', async () => {
    const t = wired('unlocked');
    await t.registry.dispatch({ method: 'tokens.add', payload: { denom: FACTORY } });
    expect(t.profile().preferredTokens).toEqual({ mainnet: ['ubze', FACTORY], testnet: ['ubze'] });
    const listed = await t.registry.dispatch({ method: 'tokens.preferred', payload: {} });
    expect(listed).toMatchObject({ ok: true });
    expect(t.writes).toEqual([]);
  });

  it('balances the profile addresses', async () => {
    const r = await wired('unlocked').registry.dispatch({
      method: 'tokens.balances',
      payload: { denom: 'ubze' },
    });
    expect(r).toMatchObject({
      ok: true,
      value: { total: '3', addresses: [{ index: 0, address: ADDR, amount: '3' }] },
    });
  });

  it('shows no tokens and no addresses while the wallet is locked, and refuses to write', async () => {
    const t = wired('locked');
    expect(await t.registry.dispatch({ method: 'tokens.preferred', payload: {} })).toEqual({
      ok: true,
      value: [],
    });
    expect(
      await t.registry.dispatch({ method: 'tokens.balances', payload: { denom: 'ubze' } }),
    ).toMatchObject({ ok: true, value: { addresses: [], total: '0' } });
    expect(
      await t.registry.dispatch({ method: 'tokens.add', payload: { denom: FACTORY } }),
    ).toMatchObject({ ok: false, error: { code: WalletErrorCodes.locked } });
  });

  it('answers needs-password in weak lock, so the popup can ask for it, and changes nothing', async () => {
    const t = wired('weak', ['ubze', FACTORY]);
    expect(
      await t.registry.dispatch({
        method: 'tokens.add',
        payload: { denom: 'factory/bze1abc/silver' },
      }),
    ).toMatchObject({ ok: false, error: { code: WalletErrorCodes.needsPassword } });
    expect(
      await t.registry.dispatch({ method: 'tokens.remove', payload: { denom: FACTORY } }),
    ).toMatchObject({ ok: false, error: { code: WalletErrorCodes.needsPassword } });
    expect(t.profile().preferredTokens).toEqual({ mainnet: ['ubze', FACTORY], testnet: ['ubze'] });
    // Reading still works in weak lock.
    const listed = await t.registry.dispatch({ method: 'tokens.preferred', payload: {} });
    expect(listed).toMatchObject({ ok: true, value: [{ denom: 'ubze' }, { denom: FACTORY }] });
  });
});

describe('tokens.lookup through the real REST and Scan clients', () => {
  // What mainnet answered for one denom of each kind but factory (covered above): an IBC token,
  // a pool's LP shares, and an LP denom whose pool pairs an IBC token with ubze.
  const recorded = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../test/fixtures/token-codes.json'), 'utf8'),
  ) as { responses: Record<string, { status: number; body: unknown }> };
  const SHERPA = 'ibc/02EE50AB3A4B7540FA001B24CB75E688016F65547CABE885EA184338440080B2';
  const LP = 'ulp/072C05CF6D235FA4D564EC9B564C1D67614A5A55E67935E1977483F940B85209';
  const LP_IBC = 'ulp_ibc/82931180F0962712BFABB189083A94C77EA90E269ABFC6D310AF922B2B14E011_ubze';

  function setupLive() {
    const network = NETWORKS.mainnet;
    const urls: string[] = [];
    const transport: HttpTransport = {
      request: ({ url }) => {
        urls.push(url);
        const hit = recorded.responses[url];
        if (hit) return Promise.resolve({ status: hit.status, body: JSON.stringify(hit.body) });
        // Anything else is unknown: the chain's gRPC not-found and Scan's own one.
        const body = url.startsWith(network.scan)
          ? { error: { code: 'not_found', message: 'no such token' } }
          : { code: 5, message: 'not found', details: [] };
        if (url.includes('/supply/by_denom?')) {
          const denom = decodeURIComponent(url.split('denom=')[1] ?? '');
          return Promise.resolve({
            status: 200,
            body: JSON.stringify({ amount: { denom, amount: '0' } }),
          });
        }
        return Promise.resolve({ status: 404, body: JSON.stringify(body) });
      },
    };
    const services = {
      activeNetwork: () => Promise.resolve(network),
      clients: () =>
        Promise.resolve({
          network,
          chain: new RestChainClient(transport, network),
          scan: new HttpScanClient(transport, network),
        }),
    } as unknown as Services;
    const kv = () => {
      const m = new Map<string, unknown>();
      return {
        get: (k: string) => Promise.resolve(m.get(k)),
        set: (k: string, v: unknown) => Promise.resolve(void m.set(k, v)),
        remove: (k: string) => Promise.resolve(void m.delete(k)),
      };
    };
    const platform = {
      storage: kv(),
      session: kv(),
      cache: kv(),
      clock: { now: () => 1_000_000, sleep: () => new Promise<never>(() => undefined) },
    } as unknown as Platform;
    const registry = new HandlerRegistry();
    registerTokenHandlers(
      registry,
      { platform, services },
      {
        preferred: { get: () => Promise.resolve(['ubze']), set: () => Promise.resolve(ok(null)) },
        addresses: { list: () => Promise.resolve([]) },
      },
    );
    const lookup = (code: string) =>
      registry.dispatch({ method: 'tokens.lookup', payload: { code } }) as Promise<
        { ok: true; value: TokenInfo } | { ok: false; error: { code: string } }
      >;
    return { lookup, urls };
  }

  it("finds an IBC token by its ibc/<hash> code, with Scan's name and decimals", async () => {
    const r = await setupLive().lookup(SHERPA);
    expect(r).toEqual({
      ok: true,
      value: {
        denom: SHERPA,
        kind: 'ibc',
        symbol: 'SHERPA',
        name: 'Sherpa',
        decimals: 6,
        source: 'scan',
        branding: null,
        logo: 'https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/sherpa.png',
      },
    });
  });

  it.each([LP, LP_IBC])('finds LP shares by their code (%s)', async (denom) => {
    const r = await setupLive().lookup(denom);
    // Bank metadata says 6 decimals for LP shares; Scan's registry says 12, which is right.
    expect(r).toMatchObject({
      ok: true,
      value: { denom, kind: 'lp', decimals: 12, source: 'scan' },
    });
  });

  it('finds ubze without asking for its supply or asking Scan', async () => {
    const live = setupLive();
    expect(await live.lookup('ubze')).toMatchObject({ ok: true, value: { symbol: 'BZE' } });
    expect(
      live.urls.filter((u) => u.includes('/supply/') || u.startsWith(NETWORKS.mainnet.scan)),
    ).toEqual([]);
  });

  it('a hash the chain does not hold is no such token, not an error', async () => {
    const r = await setupLive().lookup(SHERPA.toLowerCase());
    expect(r).toMatchObject({ ok: false, error: { code: 'no-such-token' } });
  });
});
