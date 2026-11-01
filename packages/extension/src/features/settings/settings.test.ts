import { Argon2idKdf, Vault, WebCryptoCipher, type ChainClient, type Clock } from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../background/registry';
import { ChromeSessionStorage, ChromeStorage } from '../../platform';
import { FakeArea } from '../../platform/test-support';
import {
  WalletErrorCodes,
  type Method,
  type RequestOf,
  type ResponseOf,
  type Result,
} from '../../protocol';
import type { Alarms } from '../wallet/alarms';
import { WalletService } from '../wallet/service';
import { registerSettingsHandlers } from './handlers';
import { SettingsService } from './service';

const PHRASE = `${'abandon '.repeat(23)}art`;
const PASSWORD = 'correct horse';

class FakeAlarms implements Alarms {
  readonly active = new Map<string, number>();
  set(name: string, minutes: number): Promise<void> {
    this.active.set(name, minutes);
    return Promise.resolve();
  }
  clear(name: string): Promise<void> {
    this.active.delete(name);
    return Promise.resolve();
  }
}

/** The real wallet service (real validation and sealing) over fake chrome storage areas. */
async function rig() {
  const local = new FakeArea();
  const storage = new ChromeStorage(local);
  const session = await ChromeSessionStorage.open(new FakeArea());
  const alarms = new FakeAlarms();
  let n = 0;
  const random = {
    bytes: (len: number) => Uint8Array.from({ length: len }, (_, i) => (++n * 31 + i * 7) % 256),
  };
  const clock: Clock = { now: () => 1_000_000, sleep: () => Promise.resolve() };
  const wallet = new WalletService({
    storage,
    session,
    vault: new Vault({
      random,
      cipher: new WebCryptoCipher(globalThis.crypto.subtle),
      kdf: new Argon2idKdf(),
      params: { alg: 'argon2id', m: 8, t: 1, p: 1 },
    }),
    random,
    clock,
    alarms,
    chain: () => Promise.resolve({} as ChainClient),
  });
  const registry = new HandlerRegistry();
  registerSettingsHandlers(registry, new SettingsService({ wallet, storage }));
  const call = async <M extends Method>(
    method: M,
    payload: unknown,
  ): Promise<Result<ResponseOf<M>>> =>
    (await registry.dispatch({ method, payload })) as Result<ResponseOf<M>>;
  return { call, wallet, alarms, storage };
}

async function unlocked() {
  const t = await rig();
  await t.wallet.createWallet(PASSWORD, PHRASE);
  return t;
}

const code = (r: Result<unknown>): string => (r.ok ? 'ok' : r.error.code);

describe('settings handlers', () => {
  it('reads the defaults of a new wallet', async () => {
    const t = await unlocked();
    expect(await t.call('settings.get', {})).toEqual({
      ok: true,
      value: { brandThemes: true, weakLockMinutes: 15, fullLockMinutes: 60 },
    });
  });

  it('merges a patch, persists it and re-arms both timers', async () => {
    const t = await unlocked();
    const r = await t.call('settings.set', { weakLockMinutes: 5, brandThemes: false });
    expect(r).toEqual({
      ok: true,
      value: { brandThemes: false, weakLockMinutes: 5, fullLockMinutes: 60 },
    });
    expect(Object.fromEntries(t.alarms.active)).toEqual({ 'full-lock': 60, 'weak-lock': 5 });
    await t.call('settings.set', { fullLockMinutes: 120 });
    expect(t.alarms.active.get('full-lock')).toBe(120);
    expect(await t.call('settings.get', {})).toMatchObject({ value: { weakLockMinutes: 5 } });
  });

  it('rejects full lock before weak lock and zero minutes, changing nothing', async () => {
    const t = await unlocked();
    for (const patch of [
      { fullLockMinutes: 10 },
      { weakLockMinutes: 0 },
      { weakLockMinutes: 1.5 },
    ]) {
      expect(code(await t.call('settings.set', patch))).toBe(WalletErrorCodes.invalidSettings);
    }
    expect(Object.fromEntries(t.alarms.active)).toEqual({ 'full-lock': 60, 'weak-lock': 15 });
    expect(await t.call('settings.get', {})).toMatchObject({ value: { fullLockMinutes: 60 } });
  });

  it('rejects malformed patches', async () => {
    const t = await unlocked();
    for (const bad of [{ brandThemes: 'yes' }, { weakLockMinutes: '5' }, [1]]) {
      expect(code(await t.call('settings.set', bad))).toBe('bad_request');
    }
  });

  it('reads while weak locked but needs the password to write', async () => {
    const t = await unlocked();
    await t.wallet.weakLock();
    expect(code(await t.call('settings.get', {}))).toBe('ok');
    expect(code(await t.call('settings.set', { brandThemes: false }))).toBe(
      WalletErrorCodes.needsPassword,
    );
  });

  it('answers wallet_locked after a full lock', async () => {
    const t = await unlocked();
    await t.wallet.lock();
    expect(code(await t.call('settings.get', {}))).toBe(WalletErrorCodes.locked);
  });
});

describe('network handlers', () => {
  it('defaults to mainnet and stores the chosen network', async () => {
    const t = await rig();
    expect(await t.call('network.get', {})).toEqual({ ok: true, value: { id: 'mainnet' } });
    expect(await t.call('network.set', { id: 'testnet' })).toEqual({
      ok: true,
      value: { id: 'testnet' },
    });
    expect(await t.storage.get('network')).toBe('testnet');
    expect(await t.call('network.get', {})).toEqual({ ok: true, value: { id: 'testnet' } });
  });

  it('ignores a garbage stored network and refuses unknown ids', async () => {
    const t = await rig();
    await t.storage.set('network', 'devnet');
    expect(await t.call('network.get', {})).toEqual({ ok: true, value: { id: 'mainnet' } });
    expect(code(await t.call('network.set', { id: 'devnet' }))).toBe('bad_request');
  });
});
