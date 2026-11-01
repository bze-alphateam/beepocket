import {
  Argon2idKdf,
  deriveAccount,
  LocalSigner,
  Vault,
  WebCryptoCipher,
  type ChainAccount,
  type ChainClient,
  type Clock,
  type Random,
} from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import { ChromeSessionStorage, ChromeStorage } from '../../platform';
import { FakeArea } from '../../platform/test-support';
import { HandlerRegistry } from '../../background/registry';
import type { Method, RequestOf, ResponseOf, Result } from '../../protocol';
import type { Alarms } from './alarms';
import { registerWalletHandlers } from './handlers';
import { WalletService } from './service';

const PHRASE = `${'abandon '.repeat(23)}art`;
const PHRASE_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct horse';

function counterRandom(): Random {
  let n = 0;
  return {
    bytes(len) {
      n++;
      return Uint8Array.from({ length: len }, (_, i) => (n * 31 + i * 7 + (n >> 8)) % 256);
    },
  };
}

class FakeClock implements Clock {
  t = 1_000_000;
  now(): number {
    return this.t;
  }
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

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

/** Funds and accounts per address; `failing` addresses throw on every lookup. */
class FakeChain {
  funded = new Set<string>();
  accounts = new Set<string>();
  failing = new Set<string>();
  asClient(): ChainClient {
    return {
      balances: (a: string) => {
        if (this.failing.has(a)) return Promise.reject(new Error('down'));
        return Promise.resolve(new Map(this.funded.has(a) ? [['ubze', 5n]] : []));
      },
      account: (a: string) => {
        if (this.failing.has(a)) return Promise.reject(new Error('down'));
        return Promise.resolve(
          this.accounts.has(a)
            ? ({ accountNumber: 1n, sequence: 0n, pubKey: null } satisfies ChainAccount)
            : null,
        );
      },
    } as unknown as ChainClient;
  }
}

async function rig() {
  const local = new FakeArea();
  const sessionArea = new FakeArea();
  const clock = new FakeClock();
  const alarms = new FakeAlarms();
  const chain = new FakeChain();
  const random = counterRandom();
  const storage = new ChromeStorage(local);
  const session = await ChromeSessionStorage.open(sessionArea);
  const vault = new Vault({
    random,
    cipher: new WebCryptoCipher(globalThis.crypto.subtle),
    kdf: new Argon2idKdf(),
    params: { alg: 'argon2id', m: 8, t: 1, p: 1 },
  });
  /** A fresh service over the same storage = the worker was stopped and restarted. */
  const boot = () => {
    const service = new WalletService({
      storage,
      session,
      vault,
      random,
      clock,
      alarms,
      chain: () => Promise.resolve(chain.asClient()),
    });
    const registry = new HandlerRegistry();
    registerWalletHandlers(registry, service);
    const call = async <M extends Method>(
      method: M,
      payload: RequestOf<M>,
    ): Promise<Result<ResponseOf<M>>> =>
      (await registry.dispatch({ method, payload })) as Result<ResponseOf<M>>;
    return { service, call };
  };
  return { ...boot(), boot, local, sessionArea, clock, alarms, chain };
}

const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`unexpected error ${r.error.code}`);
  return r.value;
};
const code = (r: Result<unknown>): string => (r.ok ? 'ok' : r.error.code);
const addr = (i: number): string => deriveAccount(PHRASE, i).address;

async function created() {
  const t = await rig();
  value(await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE }));
  return t;
}

describe('wallet.state / create', () => {
  it('starts uninitialised and generates a 24-word phrase without storing anything', async () => {
    const t = await rig();
    expect(value(await t.call('wallet.state', {}))).toEqual({
      state: 'uninitialised',
      retryAt: null,
    });
    const { mnemonic } = value(await t.call('wallet.generateMnemonic', {}));
    expect(mnemonic.split(' ')).toHaveLength(24);
    expect(t.local.data.size).toBe(0);
  });

  it('creates address 0 as Main, unlocked, with both timers armed', async () => {
    const t = await rig();
    const { addresses } = value(
      await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE }),
    );
    expect(addresses).toEqual([{ index: 0, label: 'Main', address: addr(0) }]);
    expect(value(await t.call('wallet.state', {})).state).toBe('unlocked');
    expect(Object.fromEntries(t.alarms.active)).toEqual({ 'full-lock': 60, 'weak-lock': 15 });
  });

  it('rejects short passwords, bad phrases, 12-word create and a second create', async () => {
    const t = await rig();
    expect(code(await t.call('wallet.createWallet', { password: 'short', mnemonic: PHRASE }))).toBe(
      'password_too_short',
    );
    expect(
      code(
        await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: 'abandon abandon' }),
      ),
    ).toBe('invalid_mnemonic');
    expect(
      code(await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE_12 })),
    ).toBe('invalid_mnemonic');
    expect(t.local.data.size).toBe(0);
    value(await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE }));
    expect(
      code(await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE })),
    ).toBe('wallet_already_initialised');
  });

  it('answers bad_request for malformed payloads', async () => {
    const t = await rig();
    for (const payload of [null, 5, { password: 1 }, { password: 'x' }]) {
      const r = await t.call('wallet.createWallet', payload as never);
      expect(code(r)).toBe('bad_request');
    }
  });
});

describe('import', () => {
  it('keeps address 0 even when only 1-4 have funds', async () => {
    const t = await rig();
    t.chain.funded.add(addr(1));
    t.chain.accounts.add(addr(3));
    const { addresses } = value(
      await t.call('wallet.importWallet', { password: PASSWORD, mnemonic: PHRASE }),
    );
    expect(addresses.map((a) => [a.index, a.label])).toEqual([
      [0, 'Main'],
      [1, 'Address 2'],
      [3, 'Address 4'],
    ]);
  });

  it('keeps only what is proven when lookups fail', async () => {
    const t = await rig();
    t.chain.failing.add(addr(1));
    t.chain.funded.add(addr(2));
    const { addresses } = value(
      await t.call('wallet.importWallet', { password: PASSWORD, mnemonic: PHRASE }),
    );
    expect(addresses.map((a) => a.index)).toEqual([0, 2]);
  });

  it('a failed balance lookup still lets the account lookup prove an address', async () => {
    const t = await rig();
    t.chain.accounts.add(addr(4));
    const { addresses } = value(
      await t.call('wallet.importWallet', { password: PASSWORD, mnemonic: PHRASE }),
    );
    expect(addresses.map((a) => a.index)).toEqual([0, 4]);
  });

  it('accepts 12 words and rejects a bad checksum', async () => {
    const t = await rig();
    value(
      await t.call('wallet.importWallet', {
        password: PASSWORD,
        mnemonic: PHRASE_12.toUpperCase(),
      }),
    );
    const bad = PHRASE_12.replace(/about$/, 'abandon');
    expect(code(await t.call('wallet.importWallet', { password: PASSWORD, mnemonic: bad }))).toBe(
      'invalid_mnemonic',
    );
  });

  it('replaces an existing vault and resets the throttle', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    for (let i = 0; i < 5; i++) await t.call('wallet.unlock', { password: 'wrong password' });
    expect(value(await t.call('wallet.state', {})).retryAt).not.toBeNull();
    value(await t.call('wallet.importWallet', { password: 'brand new pass', mnemonic: PHRASE_12 }));
    expect(value(await t.call('wallet.state', {}))).toEqual({ state: 'unlocked', retryAt: null });
    await t.call('wallet.lock', {});
    expect(value(await t.call('wallet.unlock', { password: 'brand new pass' })).status).toBe('ok');
  });
});

describe('unlock, locks and timers', () => {
  it('full lock clears session storage; unlock restores everything', async () => {
    const t = await created();
    value(await t.call('wallet.lock', {}));
    expect(t.sessionArea.data.size).toBe(0);
    expect(t.alarms.active.size).toBe(0);
    expect(value(await t.call('wallet.state', {})).state).toBe('locked');
    expect(code(await t.call('wallet.addresses', {}))).toBe('wallet_locked');
    expect(value(await t.call('wallet.unlock', { password: PASSWORD })).status).toBe('ok');
    expect(value(await t.call('wallet.state', {})).state).toBe('unlocked');
    expect(value(await t.call('wallet.addresses', {})).addresses).toHaveLength(1);
  });

  it('the weak-lock alarm removes only K and keeps the profile readable', async () => {
    const t = await created();
    await t.service.onAlarm('weak-lock');
    expect([...t.sessionArea.data.keys()]).toEqual(['wallet.profile']);
    expect(value(await t.call('wallet.state', {})).state).toBe('weakLocked');
    expect(value(await t.call('wallet.addresses', {})).addresses).toHaveLength(1);
    expect(t.alarms.active.has('weak-lock')).toBe(false);
    expect(t.alarms.active.has('full-lock')).toBe(true);
  });

  it('weak lock blocks key operations with needs-password; reauth unlocks again and re-arms', async () => {
    const t = await created();
    await t.service.onAlarm('weak-lock');
    expect(code(await t.call('wallet.deriveNext', {}))).toBe('needs-password');
    expect(code(await t.call('wallet.renameAddress', { index: 0, label: 'x' }))).toBe(
      'needs-password',
    );
    expect(value(await t.call('wallet.reauth', { password: PASSWORD })).status).toBe('ok');
    expect(value(await t.call('wallet.state', {})).state).toBe('unlocked');
    expect(t.alarms.active.get('weak-lock')).toBe(15);
  });

  it('the full-lock alarm clears the session', async () => {
    const t = await created();
    await t.service.onAlarm('full-lock');
    expect(t.sessionArea.data.size).toBe(0);
    expect(value(await t.call('wallet.state', {})).state).toBe('locked');
  });

  it('reauth when fully locked is an error, not an unlock', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    expect(code(await t.call('wallet.reauth', { password: PASSWORD }))).toBe('wallet_locked');
  });

  it('touch re-arms both timers from the settings; locked touch arms nothing', async () => {
    const t = await created();
    t.alarms.active.clear();
    await t.call('wallet.touch', {});
    expect(Object.fromEntries(t.alarms.active)).toEqual({ 'full-lock': 60, 'weak-lock': 15 });
    await t.call('wallet.lock', {});
    await t.call('wallet.touch', {});
    expect(t.alarms.active.size).toBe(0);
  });

  it('in weak lock touch re-arms only the full lock', async () => {
    const t = await created();
    await t.service.onAlarm('weak-lock');
    await t.call('wallet.touch', {});
    expect([...t.alarms.active.keys()]).toEqual(['full-lock']);
  });

  it('settings drive the periods and full must not be before weak', async () => {
    const t = await created();
    const ok1 = await t.service.updateProfile((p) => ({
      ...p,
      settings: { ...p.settings, weakLockMinutes: 5, fullLockMinutes: 20 },
    }));
    expect(ok1.ok).toBe(true);
    expect(Object.fromEntries(t.alarms.active)).toEqual({ 'full-lock': 20, 'weak-lock': 5 });
    const bad = await t.service.updateProfile((p) => ({
      ...p,
      settings: { ...p.settings, weakLockMinutes: 30, fullLockMinutes: 20 },
    }));
    expect(code(bad)).toBe('invalid_settings');
    expect(Object.fromEntries(t.alarms.active)).toEqual({ 'full-lock': 20, 'weak-lock': 5 });
  });

  it('recomputes state after a worker restart', async () => {
    const t = await created();
    const restarted = t.boot();
    expect(value(await restarted.call('wallet.state', {})).state).toBe('unlocked');
    await t.service.onAlarm('weak-lock');
    expect(value(await t.boot().call('wallet.state', {})).state).toBe('weakLocked');
    await t.service.onAlarm('full-lock');
    expect(value(await t.boot().call('wallet.state', {})).state).toBe('locked');
  });

  it('deriveNext after a restart continues the index and survives locking', async () => {
    const t = await created();
    const second = value(await t.boot().call('wallet.deriveNext', {})).address;
    expect(second).toEqual({ index: 1, label: 'Address 2', address: addr(1) });
    const third = value(await t.boot().call('wallet.deriveNext', {})).address;
    expect(third.index).toBe(2);
    await t.call('wallet.lock', {});
    await t.call('wallet.unlock', { password: PASSWORD });
    expect(value(await t.call('wallet.addresses', {})).addresses.map((a) => a.address)).toEqual([
      addr(0),
      addr(1),
      addr(2),
    ]);
  });

  it('unlock with a corrupt record is a typed error and counts no failure', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    t.local.data.set('vault', {
      v: 1,
      kdf: { alg: 'argon2id', m: 4_000_000, t: 3, p: 1, salt: 'AAAA' },
      nonce: 'AAAA',
      ct: 'AAAA',
    });
    expect(code(await t.call('wallet.unlock', { password: PASSWORD }))).toBe('vault_invalid');
    t.local.data.set('vault', 'garbage');
    expect(code(await t.call('wallet.unlock', { password: PASSWORD }))).toBe('vault_invalid');
    expect(t.local.data.has('throttle')).toBe(false);
  });

  it('unlock on first run says the wallet is uninitialised', async () => {
    const t = await rig();
    expect(code(await t.call('wallet.unlock', { password: PASSWORD }))).toBe(
      'wallet_uninitialised',
    );
  });

  it('a profile of another version is "profile_invalid", never a crash', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    t.local.data.set('profile', 'nonsense');
    expect(code(await t.call('wallet.unlock', { password: PASSWORD }))).toBe('profile_invalid');
    expect(value(await t.call('wallet.state', {})).state).toBe('locked');
  });

  it('a profile that decrypts to the wrong shape is rejected', async () => {
    const t = await created();
    const record = t.local.data.get('profile') as never;
    const vault = new Vault({
      random: counterRandom(),
      cipher: new WebCryptoCipher(globalThis.crypto.subtle),
      kdf: new Argon2idKdf(),
      params: { alg: 'argon2id', m: 8, t: 1, p: 1 },
    });
    const key = await vault.unlock(PASSWORD, t.local.data.get('vault') as never);
    t.local.data.set('profile', await vault.sealProfile(key, record, { v: 2 }));
    await t.call('wallet.lock', {});
    expect(code(await t.call('wallet.unlock', { password: PASSWORD }))).toBe('profile_invalid');
  });
});

describe('throttle', () => {
  it('follows 5 → 30 s, 10 → 60 s … capped at 15 min and persists across restarts', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    const wrong = { password: 'not the password' };
    const expected = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000];
    for (const lock of expected) {
      for (let i = 0; i < 4; i++) {
        const r = value(await t.boot().call('wallet.unlock', wrong));
        expect(r).toEqual({ status: 'wrong-password', retryAt: null });
      }
      const fifth = value(await t.boot().call('wallet.unlock', wrong));
      expect(fifth).toEqual({ status: 'wrong-password', retryAt: t.clock.t + lock });
      // Blocked: even the right password is refused, without being checked.
      const blocked = value(await t.boot().call('wallet.unlock', { password: PASSWORD }));
      expect(blocked).toEqual({ status: 'throttled', retryAt: t.clock.t + lock });
      expect(value(await t.call('wallet.state', {})).retryAt).toBe(t.clock.t + lock);
      t.clock.t += lock;
    }
  });

  it('reauth and revealMnemonic go through the same throttle; success resets it', async () => {
    const t = await created();
    await t.service.onAlarm('weak-lock');
    for (let i = 0; i < 2; i++) await t.call('wallet.reauth', { password: 'bad bad bad' });
    for (let i = 0; i < 2; i++) await t.call('wallet.revealMnemonic', { password: 'bad bad bad' });
    await t.call('wallet.unlock', { password: 'bad bad bad' });
    expect(value(await t.call('wallet.reauth', { password: PASSWORD })).status).toBe('throttled');
    expect(value(await t.call('wallet.revealMnemonic', { password: PASSWORD })).status).toBe(
      'throttled',
    );
    t.clock.t += 30_000;
    expect(value(await t.call('wallet.reauth', { password: PASSWORD })).status).toBe('ok');
    expect(t.local.data.has('throttle')).toBe(false);
  });

  it('nothing is wiped after many failures', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    for (let i = 0; i < 12; i++) {
      t.clock.t += 1_000_000;
      await t.call('wallet.unlock', { password: 'nope nope nope' });
    }
    expect(t.local.data.has('vault')).toBe(true);
    t.clock.t += 1_000_000;
    expect(value(await t.call('wallet.unlock', { password: PASSWORD })).status).toBe('ok');
  });
});

describe('reveal, rename, mnemonic secrecy', () => {
  it('reveal always asks for the password, even when unlocked', async () => {
    const t = await created();
    expect(value(await t.call('wallet.revealMnemonic', { password: 'wrong pass' })).status).toBe(
      'wrong-password',
    );
    expect(value(await t.call('wallet.revealMnemonic', { password: PASSWORD }))).toEqual({
      status: 'ok',
      mnemonic: PHRASE,
    });
    expect(value(await t.call('wallet.state', {})).state).toBe('unlocked');
  });

  it('rename trims and enforces 1–32 characters', async () => {
    const t = await created();
    expect(
      value(await t.call('wallet.renameAddress', { index: 0, label: '  Savings ' })).address.label,
    ).toBe('Savings');
    expect(code(await t.call('wallet.renameAddress', { index: 0, label: '   ' }))).toBe(
      'invalid_label',
    );
    expect(code(await t.call('wallet.renameAddress', { index: 0, label: 'x'.repeat(33) }))).toBe(
      'invalid_label',
    );
    expect(
      value(await t.call('wallet.renameAddress', { index: 0, label: 'x'.repeat(32) })).address
        .label,
    ).toHaveLength(32);
    expect(code(await t.call('wallet.renameAddress', { index: 9, label: 'ok' }))).toBe(
      'unknown_address',
    );
    await t.call('wallet.lock', {});
    await t.call('wallet.unlock', { password: PASSWORD });
    expect(value(await t.call('wallet.addresses', {})).addresses[0]?.label).toHaveLength(32);
  });

  it('the phrase is in no session value and in no reply except the two display handlers', async () => {
    const t = await rig();
    const replies: unknown[] = [];
    const run = async <M extends Method>(method: M, payload: RequestOf<M>) => {
      const r = await t.call(method, payload);
      replies.push(r);
      return r;
    };
    await run('wallet.state', {});
    await run('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
    await run('wallet.addresses', {});
    await run('wallet.deriveNext', {});
    await run('wallet.renameAddress', { index: 1, label: 'Two' });
    await run('wallet.touch', {});
    await run('wallet.reauth', { password: PASSWORD });
    await run('wallet.lock', {});
    await run('wallet.unlock', { password: PASSWORD });
    await run('wallet.unlock', { password: 'wrong wrong' });
    await run('wallet.importWallet', { password: PASSWORD, mnemonic: PHRASE });
    await run('wallet.state', {});
    const first = PHRASE.split(' ').slice(-1)[0] ?? '';
    const everything = JSON.stringify([...t.sessionArea.data.values(), replies]);
    expect(everything).not.toContain(`abandon abandon`);
    expect(everything).not.toContain(`abandon ${first}`);
    const shown = JSON.stringify(await t.call('wallet.revealMnemonic', { password: PASSWORD }));
    expect(shown).toContain(PHRASE);
    expect(JSON.stringify([...t.sessionArea.data.values()])).not.toContain('abandon abandon');
  });
});

describe('signDirect', () => {
  const doc = new Uint8Array([1, 2, 3]);
  const bytes = (b: Uint8Array): string => Buffer.from(b).toString('hex');

  it('signs with the key of the requested address and re-arms the timers', async () => {
    const t = await created();
    value(await t.call('wallet.deriveNext', {}));
    t.alarms.active.clear();
    const reference = new LocalSigner(() => Promise.resolve(PHRASE));
    const sig1 = value(await t.service.signDirect(addr(1), doc));
    const sig0 = value(await t.service.signDirect(addr(0), doc));
    // RFC 6979 signatures are deterministic: equal to the reference means that exact key.
    expect(bytes(sig1)).toBe(bytes(await reference.signDirect(1, doc)));
    expect(bytes(sig0)).toBe(bytes(await reference.signDirect(0, doc)));
    expect(bytes(sig0)).not.toBe(bytes(sig1));
    expect(t.alarms.active.size).toBe(2);
  });

  it('needs the password in weak lock, refuses unknown addresses and a locked wallet', async () => {
    const t = await created();
    expect(code(await t.service.signDirect(addr(7), doc))).toBe('unknown_address');
    expect(code(await t.service.signDirect('bze1notanaddress', doc))).toBe('unknown_address');
    await t.service.onAlarm('weak-lock');
    expect(code(await t.service.signDirect(addr(0), doc))).toBe('needs-password');
    await t.service.lock();
    expect(code(await t.service.signDirect(addr(0), doc))).toBe('wallet_locked');
  });

  it('a lock racing a signature waits for it', async () => {
    const t = await created();
    const [signed] = await Promise.all([t.service.signDirect(addr(0), doc), t.service.lock()]);
    expect(signed.ok).toBe(true);
    expect(t.sessionArea.data.size).toBe(0);
  });
});

describe('storage safety', () => {
  it('writes vault and profile in one atomic call', async () => {
    const t = await rig();
    const calls: string[][] = [];
    const original = t.local.set.bind(t.local);
    t.local.set = (items) => {
      calls.push(Object.keys(items));
      return original(items);
    };
    value(await t.call('wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE }));
    value(await t.call('wallet.importWallet', { password: PASSWORD, mnemonic: PHRASE }));
    const withVault = calls.filter((keys) => keys.includes('vault'));
    expect(withVault).toHaveLength(2);
    for (const keys of withVault) expect(keys).toContain('profile');
  });

  it('a damaged throttle record means the strictest lockout, not a fresh start', async () => {
    const t = await created();
    await t.call('wallet.lock', {});
    t.local.data.set('throttle', { failures: 'x' });
    const blocked = value(await t.call('wallet.unlock', { password: PASSWORD }));
    expect(blocked).toEqual({ status: 'throttled', retryAt: t.clock.t + 900_000 });
    t.clock.t += 900_000;
    expect(value(await t.call('wallet.unlock', { password: PASSWORD })).status).toBe('ok');
  });
});
