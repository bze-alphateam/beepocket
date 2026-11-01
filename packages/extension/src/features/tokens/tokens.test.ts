import { NETWORKS, type DenomBranding, type NetworkId, type TokenInfo } from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import { registerHandlers } from '../../background/handlers';
import { HandlerRegistry } from '../../background/registry';
import type { Services } from '../../background/services';
import type { Platform } from '../../platform';
import { registerTokenHandlers } from './handlers';
import type { PreferredTokensStore, WalletAddress, WalletAddresses } from './ports';

const FACTORY = 'factory/bze1abc/gold';
const IBC = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2';
const BRANDING: DenomBranding = {
  font: 'Inter',
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
}

function setup(opts: { addresses?: WalletAddress[]; scanDown?: boolean; preferred?: string[] } = {}) {
  const chainData: Chain = {
    supplies: { ubze: 10n, [FACTORY]: 5n, [IBC]: 5n },
    metadata: { [FACTORY]: { symbol: 'GOLD', name: 'Gold Coin', exponent: 6 } },
    branding: { [FACTORY]: BRANDING },
    balances: {},
    balanceCalls: [],
    supplyCalls: [],
  };
  const chain = (id: NetworkId) => ({
    supply: (d: string) => {
      chainData.supplyCalls.push(d);
      return Promise.resolve(chainData.supplies[d] ?? 0n);
    },
    denomMetadata: (d: string) => Promise.resolve(chainData.metadata[d] ?? null),
    denomBranding: (d: string) => Promise.resolve(chainData.branding[d] ?? null),
    balances: (a: string) => {
      chainData.balanceCalls.push(`${id}:${a}`);
      return Promise.resolve(chainData.balances[a] ?? new Map<string, bigint>());
    },
  });
  const scanCalls: string[] = [];
  const scan = {
    token: (d: string) => {
      scanCalls.push(d);
      return opts.scanDown
        ? Promise.reject(new Error('scan down'))
        : Promise.resolve({ denom: d, symbol: 'ATOM', name: 'Cosmos Hub', exponent: 6, kind: 'ibc', halted: false });
    },
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
    set: (n, d) => Promise.resolve(void prefs.set(n, [...d])),
  };
  const addresses: WalletAddresses = {
    list: () => Promise.resolve(opts.addresses ?? []),
  };

  const registry = new HandlerRegistry();
  registerTokenHandlers(registry, { platform, services }, { preferred, addresses });
  const call = <T = unknown>(method: string, payload: unknown = {}) =>
    registry.dispatch({ method, payload }) as Promise<
      { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
    >;
  return {
    call,
    chainData,
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
      value: { symbol: 'GOLD', name: 'Gold Coin', decimals: 6, source: 'chain', branding: BRANDING },
    });
  });

  it('falls back to a guess for a factory token without metadata, with null branding', async () => {
    const t = setup();
    t.chainData.metadata = {};
    t.chainData.branding = {};
    const r = await t.call<TokenInfo>('tokens.lookup', { code: FACTORY });
    expect(r).toMatchObject({ ok: true, value: { symbol: 'GOLD', source: 'fallback', branding: null } });
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

  it('answers no-such-token for a denom without supply', async () => {
    const r = await setup().call('tokens.lookup', { code: 'factory/bze1abc/ghost' });
    expect(r).toEqual({
      ok: false,
      error: { code: 'no-such-token', message: 'No token with this code on BeeZee' },
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
    t.chainData.balances['bze1a'] = new Map([['ubze', 5n], [FACTORY, 7n]]);
    t.chainData.balances['bze1b'] = new Map([['ubze', 2n]]);
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
      },
    });
  });

  it('is zero for a denom the addresses do not hold', async () => {
    const r = await withBalances().call('tokens.balances', { denom: IBC });
    expect(r).toMatchObject({ ok: true, value: { total: '0' } });
  });

  it('answers an empty list before any address exists', async () => {
    const r = await setup().call('tokens.balances', { denom: 'ubze' });
    expect(r).toEqual({ ok: true, value: { denom: 'ubze', addresses: [], total: '0' } });
  });

  it('reuses a read for 10 s, refreshes after, and on demand', async () => {
    const t = withBalances();
    await t.call('tokens.balances', { denom: 'ubze' });
    await t.call('tokens.balances', { denom: FACTORY });
    expect(t.chainData.balanceCalls).toHaveLength(2);
    t.advance(9_999);
    await t.call('tokens.balances', { denom: 'ubze' });
    expect(t.chainData.balanceCalls).toHaveLength(2);
    t.advance(1);
    await t.call('tokens.balances', { denom: 'ubze' });
    expect(t.chainData.balanceCalls).toHaveLength(4);
    await t.call('tokens.balances', { denom: 'ubze', refresh: true });
    expect(t.chainData.balanceCalls).toHaveLength(6);
  });

  it('rejects a non-boolean refresh', async () => {
    const r = await withBalances().call('tokens.balances', { denom: 'ubze', refresh: 'yes' });
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } });
  });

  it('does not share balance reads between networks', async () => {
    const t = withBalances();
    await t.call('tokens.balances', { denom: 'ubze' });
    t.useNetwork('testnet');
    await t.call('tokens.balances', { denom: 'ubze' });
    expect(t.chainData.balanceCalls.filter((c) => c.startsWith('testnet:'))).toHaveLength(2);
    expect([...t.session.m.keys()].every((k) => k.startsWith('balances:'))).toBe(true);
    expect([...t.session.m.keys()].some((k) => k.startsWith('balances:testnet:'))).toBe(true);
  });

  it('does not share token data between networks', async () => {
    const t = setup();
    await t.call('tokens.lookup', { code: FACTORY });
    t.useNetwork('testnet');
    await t.call('tokens.lookup', { code: FACTORY });
    const keys = [...t.cacheMap.keys()];
    expect(keys).toContain(`mainnet:token:${FACTORY}`);
    expect(keys).toContain(`testnet:token:${FACTORY}`);
  });
});

describe('tokens.search', () => {
  it('offers ubze alone before any address exists', async () => {
    const r = await setup().call<TokenInfo[]>('tokens.search', { query: '' });
    expect(r.ok && r.value.map((x) => x.denom)).toEqual(['ubze']);
  });

  it('matches symbol, name and denom case-insensitively over held tokens', async () => {
    const t = setup({ addresses: ADDRS });
    t.chainData.balances['bze1a'] = new Map([[FACTORY, 7n], [IBC, 0n]]);
    const bySymbol = await t.call<TokenInfo[]>('tokens.search', { query: 'gOlD' });
    expect(bySymbol.ok && bySymbol.value.map((x) => x.denom)).toEqual([FACTORY]);
    const byName = await t.call<TokenInfo[]>('tokens.search', { query: 'beezee' });
    expect(byName.ok && byName.value.map((x) => x.denom)).toEqual(['ubze']);
    const byDenom = await t.call<TokenInfo[]>('tokens.search', { query: 'BZE1ABC' });
    expect(byDenom.ok && byDenom.value.map((x) => x.denom)).toEqual([FACTORY]);
    const zero = await t.call<TokenInfo[]>('tokens.search', { query: 'atom' });
    expect(zero).toEqual({ ok: true, value: [] });
  });
});

describe('tokens.theme', () => {
  it('returns the on-chain brand palette', async () => {
    expect(await setup().call('tokens.theme', { denom: FACTORY })).toEqual({ ok: true, value: BRANDING });
  });

  it('returns null for a token without branding and for ubze', async () => {
    const t = setup();
    expect(await t.call('tokens.theme', { denom: IBC })).toEqual({ ok: true, value: null });
    expect(await t.call('tokens.theme', { denom: 'ubze' })).toEqual({ ok: true, value: null });
    expect(t.chainData.supplyCalls).not.toContain('ubze');
  });
});

describe('registerHandlers', () => {
  it('registers the token methods with the interim stores', async () => {
    const registry = new HandlerRegistry();
    const data = new Map<string, unknown>();
    const storage = {
      get: (k: string) => Promise.resolve(data.get(k)),
      set: (k: string, v: unknown) => Promise.resolve(void data.set(k, v)),
    };
    registerHandlers(registry, {
      platform: { storage } as unknown as Platform,
      services: {
        clients: () =>
          Promise.resolve({
            network: NETWORKS.mainnet,
            chain: { supply: () => Promise.resolve(1n), denomBranding: () => Promise.resolve(null) },
            scan: {},
          }),
      } as unknown as Services,
    });
    expect(await registry.dispatch({ method: 'tokens.preferred', payload: {} })).toEqual({
      ok: true,
      value: [],
    });
  });
});
