import {
  Argon2idKdf,
  deriveAccount,
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
import { bytesFromWire } from './wire';

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
  const clock = { t: 5_000, now: () => 5_000, sleep: () => Promise.resolve() };
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
  const services = { activeNetwork: () => Promise.resolve(NETWORKS[network]) } as Services;
  const delivered: { tabId: number; documentId: string | undefined; message: unknown }[] = [];
  const created: { url: string; type: string; width: number; height: number }[] = [];
  const open = new Set<number>();
  const focused: number[] = [];
  const dapp = createDappService({ session, clock } as unknown as Platform, services, wallet, {
    tabs: {
      sendMessage: (tabId, message, options) => {
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
      update: (id) => {
        focused.push(id);
        return Promise.resolve({});
      },
    },
  });

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
    ask,
    site,
    answersFor,
    delivered,
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

  it('answers a second request that needs the window with invalid-request while one waits', async () => {
    const t = await rig();
    const first = await t.ask('connect', chainId());
    const second = await t.ask('connect', chainId(), t.site('https://other.example', 2, 'doc-2'));
    expect(second.ack).toEqual({
      error: { code: 'invalid-request', message: 'Another request is waiting' },
    });
    // The first one still completes.
    await t.dapp.answer(first.id, { approve: true, index: 0 });
    expect(one(t.answersFor(first.id))).toMatchObject({ result: { name: 'Main' } });
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
    expect(await t.dapp.current()).toEqual({ status: 'locked', origin: ORIGIN });
    await t.wallet.unlock(PASSWORD);
    expect(await t.dapp.current()).toMatchObject({ status: 'connect', id: connect.id });
    await t.dapp.answer(connect.id, { approve: false });

    await t.wallet.lock();
    const key = await t.ask('getKey', chainId());
    expect(t.answersFor(key.id)).toEqual([]);
    expect(await t.dapp.current()).toEqual({ status: 'locked', origin: ORIGIN });
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
    expect(await t.dapp.current()).toEqual({ status: 'unlock', origin: ORIGIN });

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
