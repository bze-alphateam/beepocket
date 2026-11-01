import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../background/registry';
import { fail, ok, WalletErrorCodes, type Result } from '../../protocol';
import type { Profile } from '../wallet';
import { registerSettingsHandlers } from './handlers';
import { SettingsService, type SettingsWallet } from './service';

function setup(opts: { locked?: boolean; weak?: boolean } = {}) {
  let profile = {
    settings: { brandThemes: true, weakLockMinutes: 15, fullLockMinutes: 60 },
  } as Profile;
  const rearmed: number[] = [];
  const wallet: SettingsWallet = {
    getProfile: () =>
      Promise.resolve(opts.locked ? fail(WalletErrorCodes.locked, 'locked') : ok(profile)),
    updateProfile: (patch) => {
      if (opts.locked) return Promise.resolve(fail(WalletErrorCodes.locked, 'locked'));
      if (opts.weak) return Promise.resolve(fail(WalletErrorCodes.needsPassword, 'password'));
      const next = patch(structuredClone(profile));
      const { weakLockMinutes: w, fullLockMinutes: f } = next.settings;
      if (w < 1 || f < w) return Promise.resolve(fail(WalletErrorCodes.invalidSettings, 'bad'));
      profile = next;
      return Promise.resolve(ok(profile));
    },
    rearm: () => {
      rearmed.push(profile.settings.weakLockMinutes);
      return Promise.resolve();
    },
  };
  const store = new Map<string, unknown>();
  const storage = {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    },
  };
  const registry = new HandlerRegistry();
  registerSettingsHandlers(registry, new SettingsService({ wallet, storage }));
  const call = (method: string, payload: unknown): Promise<Result<unknown>> =>
    registry.dispatch({ method, payload });
  return { call, rearmed, store };
}

describe('settings handlers', () => {
  it('reads the profile settings', async () => {
    const { call } = setup();
    expect(await call('settings.get', {})).toEqual({
      ok: true,
      value: { brandThemes: true, weakLockMinutes: 15, fullLockMinutes: 60 },
    });
  });

  it('merges a patch, saves it and re-arms the timers', async () => {
    const { call, rearmed } = setup();
    const r = await call('settings.set', { weakLockMinutes: 5, brandThemes: false });
    expect(r).toEqual({
      ok: true,
      value: { brandThemes: false, weakLockMinutes: 5, fullLockMinutes: 60 },
    });
    expect(rearmed).toEqual([5]);
  });

  it('rejects full lock before weak lock and zero minutes with the typed error', async () => {
    const { call, rearmed } = setup();
    for (const patch of [{ fullLockMinutes: 10 }, { weakLockMinutes: 0 }]) {
      expect(await call('settings.set', patch)).toMatchObject({
        ok: false,
        error: { code: WalletErrorCodes.invalidSettings },
      });
    }
    expect(rearmed).toEqual([]);
  });

  it('passes through needs-password while weak locked and rejects malformed patches', async () => {
    expect(await setup({ weak: true }).call('settings.set', { brandThemes: false })).toMatchObject({
      error: { code: WalletErrorCodes.needsPassword },
    });
    const { call } = setup();
    for (const bad of [{ brandThemes: 'yes' }, { weakLockMinutes: '5' }, [1]]) {
      expect(await call('settings.set', bad)).toMatchObject({
        ok: false,
        error: { code: 'bad_request' },
      });
    }
  });

  it('answers wallet_locked when locked', async () => {
    expect(await setup({ locked: true }).call('settings.get', {})).toMatchObject({
      error: { code: WalletErrorCodes.locked },
    });
  });

  it('defaults to mainnet and stores the chosen network', async () => {
    const { call, store } = setup();
    expect(await call('network.get', {})).toEqual({ ok: true, value: { id: 'mainnet' } });
    expect(await call('network.set', { id: 'testnet' })).toEqual({
      ok: true,
      value: { id: 'testnet' },
    });
    expect(store.get('network')).toBe('testnet');
    expect(await call('network.get', {})).toEqual({ ok: true, value: { id: 'testnet' } });
  });

  it('ignores a garbage stored network and refuses unknown ids', async () => {
    const { call, store } = setup();
    store.set('network', 'devnet');
    expect(await call('network.get', {})).toEqual({ ok: true, value: { id: 'mainnet' } });
    expect(await call('network.set', { id: 'devnet' })).toMatchObject({
      error: { code: 'bad_request' },
    });
  });
});
