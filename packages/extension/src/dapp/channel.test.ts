import {
  Argon2idKdf,
  buildAuthInfo,
  buildBody,
  deriveAccount,
  encodeMsgSend,
  NETWORKS,
  Vault,
  WebCryptoCipher,
  type ChainClient,
  type NetworkId,
  type Random,
} from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import type { Services } from '../background/services';
import { ChromeSessionStorage, ChromeStorage, type Platform } from '../platform';
import { FakeArea } from '../platform/test-support';
import { WalletService } from '../features/wallet/service';
import { createDappService } from '.';
import type { DappSender } from './types';
import { bytesFromWire, bytesToWire } from './wire';

const PHRASE = `${'abandon '.repeat(23)}art`;
const PASSWORD = 'correct horse';
const ORIGIN = 'https://dex.getbze.com';

const counterRandom = (): Random => {
  let n = 0;
  return {
    bytes(len) {
      n++;
      return Uint8Array.from({ length: len }, (_, i) => (n * 31 + i * 7 + (n >> 8)) % 256);
    },
  };
};

async function rig() {
  const local = new FakeArea();
  const sessionArea = new FakeArea();
  const storage = new ChromeStorage(local);
  const session = await ChromeSessionStorage.open(sessionArea);
  const random = counterRandom();
  const vault = new Vault({
    random,
    cipher: new WebCryptoCipher(globalThis.crypto.subtle),
    kdf: new Argon2idKdf(),
    params: { alg: 'argon2id', m: 8, t: 1, p: 1 },
  });
  const clock = {
    t: 5_000,
    now: () => clock.t,
    sleep: () => Promise.resolve(),
  };
  const wallet = new WalletService({
    storage,
    session,
    vault,
    random,
    clock,
    alarms: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
    chain: () =>
      Promise.resolve({
        balances: () => Promise.resolve(new Map()),
        account: () => Promise.resolve(null),
      } as unknown as ChainClient),
  });
  let network: NetworkId = 'mainnet';
  // The node behind sign requests: BZE pays the fee, Scan is never reached.
  const chain = {
    account: () => Promise.resolve({ accountNumber: 7n, sequence: 3n, pubKey: null }),
    balances: () => Promise.resolve(new Map([['ubze', 100_000_000n]])),
    simulate: () => Promise.resolve({ gasUsed: 100_000n }),
    feeParams: () => Promise.resolve({ minGasPrice: { denom: 'ubze', amount: '0.01' } }),
    tradebinParams: () =>
      Promise.resolve({ nativeDenom: 'ubze', minNativeLiquidityForModuleSwap: 1_000n }),
    liquidityPools: () => Promise.resolve([]),
    haltedDenoms: () => Promise.resolve([]),
    markets: () => Promise.resolve([]),
    marketOrder: () => Promise.resolve(null),
    denomMetadata: () => Promise.resolve(null),
    denomBranding: () => Promise.resolve(null),
  } as unknown as ChainClient;
  const services = {
    activeNetwork: () => Promise.resolve(NETWORKS[network]),
    clients: () => Promise.resolve({ network: NETWORKS[network], chain, scan: {} }),
  } as unknown as Services;
  const unreachable = new Set<string>();
  const delivered: { tabId: number; documentId: string | undefined; message: unknown }[] = [];
  const created: { url: string; type: string; width: number; height: number }[] = [];
  const open = new Set<number>();
  const focused: number[] = [];
  const alarms = new Map<string, number>();
  const build = () =>
    createDappService({ session, clock } as unknown as Platform, services, wallet, {
      alarms: {
        set: (name, minutes) => {
          alarms.set(name, minutes);
          return Promise.resolve();
        },
        clear: (name) => {
          alarms.delete(name);
          return Promise.resolve();
        },
      },
      tabs: {
        sendMessage: (tabId, message, options) => {
          if (options?.documentId !== undefined && unreachable.has(options.documentId)) {
            return Promise.reject(new Error('no such document'));
          }
          delivered.push({ tabId, documentId: options?.documentId, message });
          return Promise.resolve();
        },
      },
      windows: {
        create: (info) => {
          created.push(info);
          open.add(created.length);
          return Promise.resolve({ id: created.length });
        },
        get: (id) => (open.has(id) ? Promise.resolve({}) : Promise.reject(new Error('no window'))),
        getLastFocused: () => Promise.reject(new Error('no window')),
        update: (id) => {
          focused.push(id);
          return Promise.resolve({});
        },
      },
    });
  const dapp = build();

  let n = 0;
  const nextId = () => (++n).toString(16).padStart(32, '0');
  const site = (origin = ORIGIN, tabId = 1, documentId = 'doc-1'): DappSender => ({
    origin,
    tabId,
    documentId,
  });
  /** A page call: acked at once, answer delivered afterwards. Returns the id and the ack. */
  const ask = async (method: string, params: unknown, from: DappSender = site()) => {
    const id = nextId();
    const received = await dapp.receive(from, { id, method, params });
    await received.after();
    return { id, ack: received.ack };
  };
  const answersFor = (id: string) =>
    delivered
      .map((d) => d.message as { dapp: { id: string } })
      .filter((m) => m.dapp.id === id)
      .map((m) => m.dapp);

  await wallet.createWallet(PASSWORD, PHRASE);
  await wallet.deriveNext();
  await wallet.deriveNext();
  return {
    wallet,
    dapp,
    /** A fresh service over the same storage: the worker was stopped and started again. */
    restart: build,
    ask,
    site,
    answersFor,
    delivered,
    unreachable,
    clock,
    alarms,
    session,
    created,
    focused,
    open,
    local,
    storage,
    vault,
    setNetwork: (id: NetworkId) => {
      network = id;
    },
  };
}

const chainId = (id: NetworkId = 'mainnet') => ({ chainId: NETWORKS[id].chainId });
const one = <T>(xs: T[]): T => {
  expect(xs).toHaveLength(1);
  return xs[0] as T;
};

describe('wrong chain', () => {
  it('refuses a chain id that is not the active network, naming the active one', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId('testnet'));
    expect(one(t.answersFor(a.id))).toMatchObject({
      error: { code: 'wrong-chain', message: 'BeePocket is on Mainnet' },
    });
    t.setNetwork('testnet');
    const b = await t.ask('getKey', chainId('mainnet'));
    expect(one(t.answersFor(b.id))).toMatchObject({
      error: { code: 'wrong-chain', message: 'BeePocket is on Testnet' },
    });
    expect(t.created).toHaveLength(0);
  });
});

describe('connect and getKey, wallet unlocked', () => {
  it('refuses getKey for a site that is not connected, without a window', async () => {
    const t = await rig();
    const a = await t.ask('getKey', chainId());
    expect(a.ack).toEqual({ accepted: true });
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'not-connected' } });
    expect(t.created).toHaveLength(0);
  });

  it('opens the request window, saves the picked address and answers the page', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId());
    expect(a.ack).toEqual({ accepted: true });
    expect(t.answersFor(a.id)).toEqual([]);
    expect(one(t.created)).toMatchObject({
      url: 'popup.html?window=request',
      type: 'popup',
      width: 360,
      height: 600,
    });

    const view = await t.dapp.current();
    expect(view).toMatchObject({ status: 'connect', origin: ORIGIN, network: 'mainnet', id: a.id });
    if (view.status !== 'connect') throw new Error('unreachable');
    expect(view.addresses.map((x) => x.index)).toEqual([0, 1, 2]);

    expect(await t.dapp.answer(a.id, { approve: true, index: 2 })).toEqual({ ok: true, value: {} });
    const expected = deriveAccount(PHRASE, 2);
    const answer = one(t.answersFor(a.id)) as unknown as { result: Record<string, unknown> };
    expect(answer.result).toMatchObject({
      address: expected.address,
      bech32Address: expected.address,
      name: 'Address 3',
      algo: 'secp256k1',
      isNanoLedger: false,
    });
    expect(bytesFromWire(answer.result.pubKey as string)).toEqual(expected.pubKey);
    expect(t.delivered[0]).toMatchObject({ tabId: 1, documentId: 'doc-1' });
    expect(await t.dapp.current()).toEqual({ status: 'none' });

    const profile = await t.wallet.getProfile();
    expect(profile.ok && profile.value.sites.mainnet[ORIGIN]).toEqual({
      address: expected.address,
      connectedAt: 5_000,
    });
  });

  it('answers a connected site at once, on that network only, and per exact origin', async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId());
    await t.dapp.answer(first.id, { approve: true, index: 1 });
    const windows = t.created.length;

    const again = await t.ask('getKey', chainId());
    expect(one(t.answersFor(again.id))).toMatchObject({
      result: { address: deriveAccount(PHRASE, 1).address, name: 'Address 2' },
    });
    const reconnect = await t.ask('connect', chainId());
    expect(one(t.answersFor(reconnect.id))).toMatchObject({
      result: { address: deriveAccount(PHRASE, 1).address },
    });
    expect(t.created).toHaveLength(windows);

    const port = await t.ask('getKey', chainId(), t.site('https://dex.getbze.com:8443'));
    expect(one(t.answersFor(port.id))).toMatchObject({ error: { code: 'not-connected' } });

    t.setNetwork('testnet');
    const testnet = await t.ask('getKey', chainId('testnet'));
    expect(one(t.answersFor(testnet.id))).toMatchObject({ error: { code: 'not-connected' } });
  });

  it('answers rejected when the user cancels', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId());
    await t.dapp.answer(a.id, { approve: false });
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'rejected' } });
    const profile = await t.wallet.getProfile();
    expect(profile.ok && profile.value.sites.mainnet).toEqual({});
  });

  it('focuses the open window instead of opening another, and opens a new one after it closed', async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId());
    await t.dapp.answer(first.id, { approve: false });
    await t.ask('connect', chainId());
    expect(t.created).toHaveLength(1);
    expect(t.focused).toEqual([1]);
  });

  it('opens a new window once the old one is gone', async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId());
    await t.dapp.answer(first.id, { approve: false });
    t.open.clear();
    await t.ask('connect', chainId());
    expect(t.created).toHaveLength(2);
  });

  it('forgets the requests of a closed tab', async () => {
    const t = await rig();
    await t.ask('connect', chainId(), t.site(ORIGIN, 7, 'doc-7'));
    await t.dapp.onTabRemoved(8);
    expect(await t.dapp.current()).toMatchObject({ status: 'connect' });
    await t.dapp.onTabRemoved(7);
    expect(await t.dapp.current()).toEqual({ status: 'none' });
    const late = await t.ask('connect', chainId());
    expect(late.ack).toEqual({ accepted: true });
  });

  it('refuses malformed requests at once', async () => {
    const t = await rig();
    for (const message of [
      null,
      'connect',
      { id: 'short', method: 'connect', params: chainId() },
      { id: 'a'.repeat(32), method: 'wallet.unlock', params: {} },
      { id: 'a'.repeat(32), method: 'connect', params: { chainId: 5 } },
      { id: 'a'.repeat(32), method: 'connect' },
    ]) {
      const received = await t.dapp.receive(t.site(), message);
      expect(received.ack).toMatchObject({ error: { code: 'invalid-request' } });
    }
    expect(t.created).toHaveLength(0);
  });

  it('keeps a request waiting when its answer cannot complete', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId());
    expect(await t.dapp.answer('f'.repeat(32), { approve: true, index: 0 })).toMatchObject({
      ok: false,
      error: { code: 'unknown-request' },
    });
    expect(await t.dapp.answer(a.id, { approve: true, index: 99 })).toMatchObject({
      ok: false,
      error: { code: 'unknown_address' },
    });
    expect(await t.dapp.current()).toMatchObject({ status: 'connect', id: a.id });
  });
});

describe('connect and getKey, wallet locked', () => {
  it('waits on the unlock screen for both methods, then asks (connect) or answers (getKey)', async () => {
    const t = await rig();
    await t.wallet.lock();
    const connect = await t.ask('connect', chainId());
    expect(connect.ack).toEqual({ accepted: true });
    expect(t.created).toHaveLength(1);
    expect(await t.dapp.current()).toMatchObject({ status: 'locked', origin: ORIGIN });
    await t.wallet.unlock(PASSWORD);
    expect(await t.dapp.current()).toMatchObject({ status: 'connect', id: connect.id });
    await t.dapp.answer(connect.id, { approve: false });

    await t.wallet.lock();
    const key = await t.ask('getKey', chainId());
    expect(t.answersFor(key.id)).toEqual([]);
    expect(await t.dapp.current()).toMatchObject({ status: 'locked', origin: ORIGIN });
    await t.wallet.unlock(PASSWORD);
    expect(await t.dapp.current()).toEqual({ status: 'none' });
    expect(one(t.answersFor(key.id))).toMatchObject({ error: { code: 'not-connected' } });
  });

  it('answers a wallet that does not exist yet with not-connected', async () => {
    const t = await rig();
    await t.local.remove('vault');
    const a = await t.ask('getKey', chainId());
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'not-connected' } });
  });
});

describe('connect and getKey, wallet weakly locked', () => {
  it('answers a connected site from the stored public key without the password', async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId());
    await t.dapp.answer(first.id, { approve: true, index: 1 });
    await t.wallet.weakLock();
    const a = await t.ask('getKey', chainId());
    expect(one(t.answersFor(a.id))).toMatchObject({
      result: { address: deriveAccount(PHRASE, 1).address },
    });
  });

  it('needs the password to save a new site: the request keeps waiting', async () => {
    const t = await rig();
    await t.wallet.weakLock();
    const a = await t.ask('connect', chainId());
    expect(await t.dapp.current()).toMatchObject({ status: 'connect' });
    expect(await t.dapp.answer(a.id, { approve: true, index: 0 })).toMatchObject({
      ok: false,
      error: { code: 'needs-password' },
    });
    expect(await t.dapp.current()).toMatchObject({ status: 'connect', id: a.id });
    await t.wallet.reauth(PASSWORD);
    expect(await t.dapp.answer(a.id, { approve: true, index: 0 })).toMatchObject({ ok: true });
    expect(one(t.answersFor(a.id))).toMatchObject({ result: { name: 'Main' } });
  });

  it('waits for the password when the stored public key is missing, then backfills it', async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId());
    await t.dapp.answer(first.id, { approve: true, index: 0 });
    await t.wallet.updateProfile((p) => {
      p.addresses = p.addresses.map((a) => ({
        index: a.index,
        label: a.label,
        address: a.address,
      }));
      return p;
    });
    await t.wallet.weakLock();

    const a = await t.ask('getKey', chainId());
    expect(t.answersFor(a.id)).toEqual([]);
    expect(await t.dapp.current()).toMatchObject({ status: 'unlock', origin: ORIGIN });

    await t.wallet.reauth(PASSWORD);
    expect(await t.dapp.current()).toEqual({ status: 'none' });
    expect(one(t.answersFor(a.id))).toMatchObject({
      result: { address: deriveAccount(PHRASE, 0).address },
    });
  });
});

describe('public keys in the profile', () => {
  it('stores the key of every derived address', async () => {
    const t = await rig();
    const profile = await t.wallet.getProfile();
    if (!profile.ok) throw new Error('locked');
    for (const a of profile.value.addresses) {
      expect(bytesFromWire(a.pubKey ?? '')).toEqual(deriveAccount(PHRASE, a.index).pubKey);
    }
  });

  it('backfills missing keys on the next full unlock', async () => {
    const t = await rig();
    await t.wallet.updateProfile((p) => {
      p.addresses = p.addresses.map((a) => ({
        index: a.index,
        label: a.label,
        address: a.address,
      }));
      return p;
    });
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    const profile = await t.wallet.getProfile();
    if (!profile.ok) throw new Error('locked');
    expect(profile.value.addresses.every((a) => a.pubKey !== undefined)).toBe(true);
    // Stored too, not only in the session: a second full unlock finds them.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    const again = await t.wallet.getProfile();
    expect(again.ok && again.value.addresses[1]?.pubKey).toBe(profile.value.addresses[1]?.pubKey);
  });
});

describe('connected sites in the profile', () => {
  it('drops invalid site entries on load and keeps the valid ones', async () => {
    const t = await rig();
    const good = deriveAccount(PHRASE, 1).address;
    await t.wallet.updateProfile((p) => {
      p.sites.mainnet[ORIGIN] = { address: good, connectedAt: 1 };
      return p;
    });
    // Seal a profile that also holds bad entries, as an older or damaged one might.
    const key = await t.vault.unlock(PASSWORD, (await t.storage.get('vault')) as never);
    const record = (await t.storage.get('profile')) as never;
    const profile = (await t.wallet.getProfile()) as unknown as { value: Record<string, unknown> };
    await t.storage.set(
      'profile',
      await t.vault.sealProfile(key, record, {
        ...profile.value,
        sites: {
          mainnet: {
            [ORIGIN]: { address: good, connectedAt: 1 },
            'https://dex.getbze.com/path': { address: good, connectedAt: 1 },
            'https://stranger.example': { address: 'bze1notmine', connectedAt: 1 },
            'https://broken.example': 'nope',
          },
          testnet: [],
        },
      }),
    );
    await t.wallet.lock();
    expect((await t.wallet.unlock(PASSWORD)).ok).toBe(true);
    const loaded = await t.wallet.getProfile();
    expect(loaded.ok && loaded.value.sites).toEqual({
      mainnet: { [ORIGIN]: { address: good, connectedAt: 1 } },
      testnet: {},
    });
  });

  it('refuses a stored profile whose public key is malformed', async () => {
    const t = await rig();
    const key = await t.vault.unlock(PASSWORD, (await t.storage.get('vault')) as never);
    const profile = (await t.wallet.getProfile()) as unknown as {
      value: { addresses: Record<string, unknown>[] };
    };
    const addresses = profile.value.addresses.map((a, i) =>
      i === 1 ? { ...a, pubKey: 'not a key' } : a,
    );
    await t.storage.set(
      'profile',
      await t.vault.sealProfile(key, (await t.storage.get('profile')) as never, {
        ...profile.value,
        addresses,
      }),
    );
    await t.wallet.lock();
    expect(await t.wallet.unlock(PASSWORD)).toMatchObject({
      ok: false,
      error: { code: 'profile_invalid' },
    });
  });
});

describe('connected sites', () => {
  const OTHER = 'https://app.cointrunk.io';
  const pushes = (t: Awaited<ReturnType<typeof rig>>) =>
    t.delivered
      .filter((d) => (d.message as { dapp: { event?: string } }).dapp.event === 'accountChanged')
      .map((d) => `${String(d.tabId)}:${String(d.documentId)}`)
      .sort();

  /** Connects `from` with the address at `index`. */
  async function connectSite(t: Awaited<ReturnType<typeof rig>>, from: DappSender, index = 0) {
    const a = await t.ask('connect', chainId(), from);
    expect((await t.dapp.answer(a.id, { approve: true, index })).ok).toBe(true);
  }

  it('lists the sites of the active network, newest first, with the current address labels', async () => {
    const t = await rig();
    await connectSite(t, t.site(OTHER, 2, 'doc-2'), 0);
    t.clock.t += 1_000;
    await connectSite(t, t.site(ORIGIN, 1, 'doc-1'), 2);
    const listed = await t.dapp.sites.list();
    if (!listed.ok) throw new Error('list failed');
    expect(listed.value.network).toBe('mainnet');
    expect(listed.value.sites.map((s) => [s.origin, s.label])).toEqual([
      [ORIGIN, 'Address 3'],
      [OTHER, 'Main'],
    ]);
    expect(listed.value.addresses.map((a) => a.index)).toEqual([0, 1, 2]);

    t.setNetwork('testnet');
    const other = await t.dapp.sites.list();
    expect(other.ok && other.value.sites).toEqual([]);
  });

  it('Change rewrites the address, pushes to that origin only and getKey follows', async () => {
    const t = await rig();
    await connectSite(t, t.site(ORIGIN, 1, 'doc-1'), 0);
    await connectSite(t, t.site(OTHER, 2, 'doc-2'), 0);
    await t.ask('getKey', chainId(), t.site(ORIGIN, 3, 'doc-3'));

    expect(await t.dapp.sites.change(ORIGIN, 1)).toEqual({ ok: true, value: {} });
    expect(pushes(t)).toEqual(['1:doc-1', '3:doc-3']);
    expect(t.delivered.at(-1)?.message).toEqual({ dapp: { event: 'accountChanged' } });

    const key = await t.ask('getKey', chainId());
    expect(one(t.answersFor(key.id))).toMatchObject({
      result: { address: deriveAccount(PHRASE, 1).address, name: 'Address 2' },
    });
  });

  it('Change refuses an unknown site or address and pushes nothing', async () => {
    const t = await rig();
    await connectSite(t, t.site());
    expect(await t.dapp.sites.change(OTHER, 1)).toMatchObject({
      ok: false,
      error: { code: 'unknown-site' },
    });
    expect(await t.dapp.sites.change(ORIGIN, 9)).toMatchObject({
      ok: false,
      error: { code: 'unknown_address' },
    });
    expect(pushes(t)).toEqual([]);
  });

  it('Disconnect removes the site, tells its pages and the next getKey is not-connected', async () => {
    const t = await rig();
    await connectSite(t, t.site(ORIGIN, 1, 'doc-1'));
    await connectSite(t, t.site(OTHER, 2, 'doc-2'));

    expect(await t.dapp.sites.disconnect(ORIGIN)).toEqual({ ok: true, value: {} });
    expect(pushes(t)).toEqual(['1:doc-1']);
    const key = await t.ask('getKey', chainId());
    expect(one(t.answersFor(key.id))).toMatchObject({ error: { code: 'not-connected' } });
    const listed = await t.dapp.sites.list();
    expect(listed.ok && listed.value.sites.map((s) => s.origin)).toEqual([OTHER]);
    expect(await t.dapp.sites.disconnect(ORIGIN)).toMatchObject({
      ok: false,
      error: { code: 'unknown-site' },
    });
  });

  it('needs the wallet unlocked to change or disconnect', async () => {
    const t = await rig();
    await connectSite(t, t.site());
    await t.wallet.weakLock();
    expect(await t.dapp.sites.disconnect(ORIGIN)).toMatchObject({
      ok: false,
      error: { code: 'needs-password' },
    });
    expect(pushes(t)).toEqual([]);
  });

  it('a network switch pushes to every recorded document', async () => {
    const t = await rig();
    await t.ask('getKey', chainId(), t.site(ORIGIN, 1, 'doc-1'));
    await t.ask('getKey', chainId(), t.site(OTHER, 2, 'doc-2'));
    await t.dapp.networkChanged();
    expect(pushes(t)).toEqual(['1:doc-1', '2:doc-2']);
  });

  it('forgets a document whose push failed, and a closed tab', async () => {
    const t = await rig();
    await t.ask('getKey', chainId(), t.site(ORIGIN, 1, 'doc-1'));
    await t.ask('getKey', chainId(), t.site(ORIGIN, 2, 'doc-2'));
    await t.ask('getKey', chainId(), t.site(ORIGIN, 3, 'doc-3'));
    t.unreachable.add('doc-1');
    await t.dapp.networkChanged();
    t.unreachable.clear();
    await t.dapp.onTabRemoved(2);
    t.delivered.length = 0;
    await t.dapp.networkChanged();
    expect(pushes(t)).toEqual(['3:doc-3']);
  });

  it('records a document once and keeps the 200 newest', async () => {
    const t = await rig();
    for (let i = 0; i < 201; i++) {
      await t.ask('getKey', chainId(), t.site(ORIGIN, i, `doc-${String(i)}`));
    }
    await t.ask('getKey', chainId(), t.site(ORIGIN, 5, 'doc-5'));
    await t.dapp.networkChanged();
    const sent = pushes(t);
    expect(sent).toHaveLength(200);
    expect(sent).not.toContain('0:doc-0');
    expect(sent.filter((s) => s === '5:doc-5')).toHaveLength(1);
  });
});

const at = (n: number) => `https://site${String(n)}.example`;
const MINUTE = 60_000;

describe('request queue', () => {
  it('shows the head only, in arrival order, with the count behind it', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    const b = await t.ask('connect', chainId(), t.site(at(2), 2, 'd2'));
    const c = await t.ask('connect', chainId(), t.site(at(3), 3, 'd3'));
    expect(t.created).toHaveLength(1);
    expect(await t.dapp.current()).toMatchObject({ status: 'connect', id: a.id, count: 3 });
    expect(await t.dapp.queue()).toEqual({
      head: at(1),
      count: 3,
      origins: [at(1), at(2), at(3)],
    });

    await t.dapp.answer(a.id, { approve: false });
    expect(await t.dapp.current()).toMatchObject({ id: b.id, count: 2 });
    await t.dapp.answer(b.id, { approve: false });
    expect(await t.dapp.current()).toMatchObject({ id: c.id, count: 1 });
    await t.dapp.answer(c.id, { approve: false });
    expect(await t.dapp.current()).toEqual({ status: 'none' });
  });

  it('keeps 5 requests per site, answering the rest invalid-request', async () => {
    const t = await rig();
    for (let i = 0; i < 5; i++) {
      const ok = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
      expect(ok.ack).toEqual({ accepted: true });
    }
    const sixth = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    expect(sixth.ack).toEqual({
      error: { code: 'invalid-request', message: 'Too many requests waiting' },
    });
    // The hostile site did not take anybody else's place.
    for (let i = 2; i <= 4; i++) {
      for (let j = 0; j < 5; j++) {
        const ok = await t.ask('connect', chainId(), t.site(at(i), i, `d${String(i)}`));
        expect(ok.ack).toEqual({ accepted: true });
      }
    }
    expect((await t.dapp.queue()).count).toBe(20);
  });

  it("lets a new site in when other sites fill the queue, ending the busiest one's oldest", async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    for (let i = 1; i <= 4; i++) {
      for (let j = i === 1 ? 1 : 0; j < 5; j++) {
        await t.ask('connect', chainId(), t.site(at(i), i, `d${String(i)}`));
      }
    }
    expect((await t.dapp.queue()).count).toBe(20);
    const fresh = await t.ask('connect', chainId(), t.site(at(5), 5, 'd5'));
    expect(fresh.ack).toEqual({ accepted: true });
    const queue = await t.dapp.queue();
    expect(queue.count).toBe(20);
    expect(queue.origins).toContain(at(5));
    expect(one(t.answersFor(first.id))).toMatchObject({ error: { code: 'invalid-request' } });
  });

  it('opens one window when requests arrive together', async () => {
    const t = await rig();
    await Promise.all([
      t.ask('connect', chainId(), t.site(at(1), 1, 'd1')),
      t.ask('connect', chainId(), t.site(at(2), 2, 'd2')),
    ]);
    expect(t.created).toHaveLength(1);
  });

  it('refuses a request id that is already waiting', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    const again = await t.dapp.receive(t.site(at(1), 1, 'd1'), {
      id: a.id,
      method: 'connect',
      params: chainId(),
    });
    expect(again.ack).toMatchObject({ error: { code: 'invalid-request' } });
    expect((await t.dapp.queue()).count).toBe(1);
  });

  it('does not queue what needs no window', async () => {
    const t = await rig();
    for (let i = 0; i < 25; i++) await t.ask('getKey', chainId(), t.site(at(1), 1, 'd1'));
    expect((await t.dapp.queue()).count).toBe(0);
    expect(t.created).toHaveLength(0);
  });

  it('answers every queued request rejected when the window is closed', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    const b = await t.ask('connect', chainId(), t.site(at(2), 2, 'd2'));
    await t.dapp.onWindowRemoved(99);
    expect((await t.dapp.queue()).count).toBe(2);
    await t.dapp.onWindowRemoved(1);
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'rejected' } });
    expect(one(t.answersFor(b.id))).toMatchObject({ error: { code: 'rejected' } });
    expect((await t.dapp.queue()).count).toBe(0);
    expect(t.alarms.has('dapp-expiry')).toBe(false);
  });

  it('removes only the requests of a closed tab', async () => {
    const t = await rig();
    await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    const b = await t.ask('connect', chainId(), t.site(at(2), 2, 'd2'));
    await t.dapp.onTabRemoved(1);
    expect(await t.dapp.queue()).toEqual({ head: at(2), count: 1, origins: [at(2)] });
    expect(await t.dapp.current()).toMatchObject({ id: b.id });
  });

  it('expires a request after 10 minutes with the alarm set to the earliest one', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    t.clock.t += 4 * MINUTE;
    const b = await t.ask('connect', chainId(), t.site(at(2), 2, 'd2'));
    // 10 minutes after the first request, which is 6 from now.
    expect(t.alarms.get('dapp-expiry')).toBe(6);

    t.clock.t += 6 * MINUTE;
    await t.dapp.onExpiry();
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'expired' } });
    expect(t.answersFor(b.id)).toEqual([]);
    expect(t.alarms.get('dapp-expiry')).toBe(4);
    expect(await t.dapp.current()).toMatchObject({ id: b.id, count: 1 });

    t.clock.t += 4 * MINUTE;
    await t.dapp.onExpiry();
    expect(one(t.answersFor(b.id))).toMatchObject({ error: { code: 'expired' } });
    expect(t.alarms.has('dapp-expiry')).toBe(false);
  });

  it('never approves an expired request, even if the window answers late', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    t.clock.t += 10 * MINUTE;
    const res = await t.dapp.answer(a.id, { approve: true, index: 0 });
    expect(res).toMatchObject({ ok: false, error: { code: 'unknown-request' } });
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'expired' } });
  });

  it('lets expired requests make room for a new one', async () => {
    const t = await rig();
    for (let i = 0; i < 5; i++) await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    t.clock.t += 10 * MINUTE;
    const fresh = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    expect(fresh.ack).toEqual({ accepted: true });
    expect((await t.dapp.queue()).count).toBe(1);
  });

  it('keeps the queue, the count and the expiry across a worker restart', async () => {
    const t = await rig();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    const b = await t.ask('connect', chainId(), t.site(at(2), 2, 'd2'));
    const again = t.restart();
    expect(await again.current()).toMatchObject({ id: a.id, count: 2 });
    t.clock.t += 10 * MINUTE;
    await again.onExpiry();
    expect(one(t.answersFor(a.id))).toMatchObject({ error: { code: 'expired' } });
    expect(one(t.answersFor(b.id))).toMatchObject({ error: { code: 'expired' } });
    // The window was stored too: closing it now finds nothing left to reject.
    await t.restart().onWindowRemoved(1);
    expect(t.delivered).toHaveLength(2);
  });

  it('leaves a request waiting while the wallet is locked, then shows it after unlock', async () => {
    const t = await rig();
    await t.wallet.lock();
    const a = await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    expect(await t.dapp.current()).toMatchObject({ status: 'locked', origin: at(1), count: 1 });
    expect(await t.dapp.queue()).toMatchObject({ head: at(1), count: 1 });
    expect(t.answersFor(a.id)).toEqual([]);
    await t.wallet.unlock(PASSWORD);
    expect(await t.dapp.current()).toMatchObject({ status: 'connect', id: a.id });
  });

  it('opens the window from the unlock screen only when something waits', async () => {
    const t = await rig();
    await t.dapp.openWindow();
    expect(t.created).toHaveLength(0);
    await t.ask('connect', chainId(), t.site(at(1), 1, 'd1'));
    await t.dapp.openWindow();
    expect(t.focused).toEqual([1]);
  });
});

describe('signDirect through the composition root', () => {
  it("shows BZE's fee with the wallet's own BZE logo", async () => {
    const t = await rig();
    const c = await t.ask('connect', chainId());
    await t.dapp.current();
    await t.dapp.answer(c.id, { approve: true, index: 0 });
    const main = deriveAccount(PHRASE, 0);
    const bodyBytes = buildBody({
      messages: [
        encodeMsgSend({
          fromAddress: main.address,
          toAddress: deriveAccount(PHRASE, 1).address,
          amount: [{ denom: 'ubze', amount: '1000000' }],
        }),
      ],
    });
    const authInfoBytes = buildAuthInfo({
      pubKey: main.pubKey,
      sequence: 3n,
      fee: { amount: [{ denom: 'ubze', amount: '1' }], gasLimit: 1n },
    });
    await t.ask('signDirect', {
      ...chainId(),
      signer: main.address,
      signDoc: {
        bodyBytes: bytesToWire(bodyBytes),
        authInfoBytes: bytesToWire(authInfoBytes),
        ...chainId(),
        accountNumber: '7',
      },
    });
    const view = await t.dapp.current();
    expect(view).toMatchObject({
      status: 'sign',
      fee: { denom: 'ubze', symbol: 'BZE', logo: '/tokens/bze.png' },
    });
    if (view.status !== 'sign') throw new Error('unreachable');
    expect(view.options.find((o) => o.denom === 'ubze')?.logo).toBe('/tokens/bze.png');
  });
});
