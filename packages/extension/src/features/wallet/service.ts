import {
  deriveAccount,
  InvalidRecordError,
  LocalSigner,
  passwordRules,
  PasswordThrottle,
  validateMnemonic,
  createMnemonic,
  WrongPasswordError,
  DecryptError,
  INITIAL_THROTTLE_STATE,
  type ChainClient,
  type Clock,
  type EncryptedRecord,
  type Random,
  type ThrottleState,
  type Vault,
} from '@beepocket/core';
import {
  fail,
  ok,
  WalletErrorCodes as Codes,
  type PasswordOutcome,
  type Result,
  type WalletAddress,
  type WalletState,
} from '../../protocol';
import type { SessionStorage, Storage } from '../../platform';
import { FULL_LOCK_ALARM, WEAK_LOCK_ALARM, type Alarms } from './alarms';
import {
  defaultLabel,
  MAX_LABEL_LENGTH,
  newProfile,
  validProfile,
  validSettings,
  type Profile,
  type ProfileAddress,
} from './profile';

export const VAULT_KEY = 'vault';
export const PROFILE_KEY = 'profile';
export const THROTTLE_KEY = 'throttle';
export const SESSION_KEY = 'wallet.key';
export const SESSION_PROFILE = 'wallet.profile';

const CREATE_WORDS = 24;
const IMPORT_SCAN = 5;
const CORRUPT_FAILURES = 30;
const MAX_LOCKOUT_MS = 15 * 60_000;

export interface WalletDeps {
  storage: Storage;
  session: SessionStorage;
  vault: Vault;
  random: Random;
  clock: Clock;
  alarms: Alarms;
  /** Chain client of the active network, used to find the funded addresses of an import. */
  chain(): Promise<ChainClient>;
  /** Told the new state whenever it changes, so an open popup can follow. Failures are ignored. */
  onStateChange?(state: { state: WalletState; retryAt: number | null }): void;
}

type Rejection = Extract<PasswordOutcome, { status: 'wrong-password' | 'throttled' }>;
interface Opened {
  key: Uint8Array;
  vault: EncryptedRecord;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== 'string') return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function isRecord(x: unknown): x is EncryptedRecord {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function validThrottle(x: unknown): x is ThrottleState {
  return (
    typeof x === 'object' &&
    x !== null &&
    'failures' in x &&
    'lockedUntil' in x &&
    Number.isSafeInteger(x.failures) &&
    (x.failures as number) >= 0 &&
    typeof x.lockedUntil === 'number' &&
    Number.isFinite(x.lockedUntil)
  );
}

/**
 * The wallet inside the service worker: vault, lock states, addresses and the profile.
 * It is the only place keys exist. The recovery phrase is decrypted only for the moment a
 * call needs it and never kept in a field; state lives in storage so a restarted worker
 * recomputes it (session storage holds K and the profile, never the phrase).
 */
export class WalletService {
  private readonly throttle = new PasswordThrottle();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: WalletDeps) {}

  /** Mutations run one after another: no lost profile updates, no parallel password guesses. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  // ---- state ----

  async state(): Promise<{ state: WalletState; retryAt: number | null }> {
    const retryAt = await this.retryAt();
    if ((await this.deps.storage.get(VAULT_KEY)) === undefined) {
      return { state: 'uninitialised', retryAt };
    }
    if ((await this.sessionProfile()) === null) return { state: 'locked', retryAt };
    const state = (await this.sessionKey()) === null ? 'weakLocked' : 'unlocked';
    return { state, retryAt };
  }

  /** Pushes the current state to the listener; never throws. */
  private async notify(): Promise<void> {
    if (!this.deps.onStateChange) return;
    try {
      this.deps.onStateChange(await this.state());
    } catch {
      // a popup that is not listening must not break a lock
    }
  }

  generateMnemonic(): string {
    return createMnemonic(this.deps.random);
  }

  // ---- create / import ----

  createWallet(
    password: string,
    mnemonic: string,
  ): Promise<Result<{ addresses: WalletAddress[] }>> {
    return this.exclusive(async () => {
      const checked = this.checkNew(password, mnemonic, true);
      if (!checked.ok) return checked;
      if ((await this.deps.storage.get(VAULT_KEY)) !== undefined) {
        return fail(Codes.alreadyInitialised, 'A wallet already exists. Import to replace it.');
      }
      const profile = newProfile([this.profileAddress(checked.value, 0)]);
      return this.install(password, checked.value, profile);
    });
  }

  importWallet(
    password: string,
    mnemonic: string,
  ): Promise<Result<{ addresses: WalletAddress[] }>> {
    return this.exclusive(async () => {
      const checked = this.checkNew(password, mnemonic, false);
      if (!checked.ok) return checked;
      const addresses = await this.detectAddresses(checked.value);
      return this.install(password, checked.value, newProfile(addresses));
    });
  }

  // ---- unlock / lock ----

  unlock(password: string): Promise<Result<PasswordOutcome>> {
    return this.exclusive(async () => {
      const attempt = await this.attempt(password);
      if (!attempt.ok) return attempt;
      if ('status' in attempt.value) return ok(attempt.value);
      const { key } = attempt.value;
      try {
        const profile = await this.loadProfile(key);
        if (!profile.ok) return profile;
        await this.deps.session.set(SESSION_KEY, toBase64(key));
        await this.deps.session.set(SESSION_PROFILE, profile.value);
        await this.rearm();
        await this.notify();
        return ok({ status: 'ok' });
      } finally {
        key.fill(0);
      }
    });
  }

  reauth(password: string): Promise<Result<PasswordOutcome>> {
    return this.exclusive(async () => {
      if ((await this.sessionProfile()) === null) {
        return fail(Codes.locked, 'The wallet is locked. Unlock it first.');
      }
      const attempt = await this.attempt(password);
      if (!attempt.ok) return attempt;
      if ('status' in attempt.value) return ok(attempt.value);
      const { key } = attempt.value;
      try {
        await this.deps.session.set(SESSION_KEY, toBase64(key));
      } finally {
        key.fill(0);
      }
      await this.rearm();
      await this.notify();
      return ok({ status: 'ok' });
    });
  }

  revealMnemonic(password: string): Promise<Result<PasswordOutcome<{ mnemonic: string }>>> {
    return this.exclusive(async () => {
      const attempt = await this.attempt(password);
      if (!attempt.ok) return attempt;
      if ('status' in attempt.value) return ok(attempt.value);
      const { key, vault } = attempt.value;
      try {
        return ok({
          status: 'ok' as const,
          mnemonic: await this.deps.vault.openMnemonic(key, vault),
        });
      } finally {
        key.fill(0);
      }
    });
  }

  /** Full lock: nothing stays in session storage. */
  lock(): Promise<void> {
    return this.exclusive(async () => {
      await this.lockNow();
      await this.notify();
    });
  }

  private async lockNow(): Promise<void> {
    await this.deps.session.remove(SESSION_KEY);
    await this.deps.session.remove(SESSION_PROFILE);
    await this.deps.alarms.clear(WEAK_LOCK_ALARM);
    await this.deps.alarms.clear(FULL_LOCK_ALARM);
  }

  /** Weak lock: only K goes, the decrypted profile stays so the wallet can still be shown. */
  weakLock(): Promise<void> {
    return this.exclusive(async () => {
      await this.weakLockNow();
      await this.notify();
    });
  }

  private async weakLockNow(): Promise<void> {
    await this.deps.session.remove(SESSION_KEY);
    await this.deps.alarms.clear(WEAK_LOCK_ALARM);
  }

  /** Called when a `chrome.alarms` alarm fires (also right after a worker restart). */
  async onAlarm(name: string): Promise<void> {
    if (name === WEAK_LOCK_ALARM) await this.weakLock();
    else if (name === FULL_LOCK_ALARM) await this.lock();
  }

  /**
   * Restarts both lock timers from the profile's settings (the weak lock timer only runs
   * while K is held). Nothing to do when locked. The send story calls it after every signature.
   */
  async rearm(): Promise<void> {
    const profile = await this.sessionProfile();
    if (profile === null) return;
    await this.deps.alarms.set(FULL_LOCK_ALARM, profile.settings.fullLockMinutes);
    if ((await this.sessionKey()) === null) await this.deps.alarms.clear(WEAK_LOCK_ALARM);
    else await this.deps.alarms.set(WEAK_LOCK_ALARM, profile.settings.weakLockMinutes);
  }

  // ---- addresses ----

  async addresses(): Promise<Result<{ addresses: WalletAddress[] }>> {
    const profile = await this.sessionProfile();
    if (profile === null) return fail(Codes.locked, 'The wallet is locked.');
    return ok({ addresses: profile.addresses.map(toWalletAddress) });
  }

  deriveNext(): Promise<Result<{ address: WalletAddress }>> {
    return this.exclusive(async () => {
      const opened = await this.requireKey();
      if (!opened.ok) return opened;
      const { key, vault } = opened.value;
      const profile = await this.sessionProfile();
      if (profile === null) return fail(Codes.locked, 'The wallet is locked.');
      const index = Math.max(...profile.addresses.map((a) => a.index)) + 1;
      const mnemonic = await this.deps.vault.openMnemonic(key, vault);
      const entry = this.profileAddress(mnemonic, index);
      const updated = await this.save(key, {
        ...profile,
        addresses: [...profile.addresses, entry],
      });
      if (!updated.ok) return updated;
      return ok({ address: toWalletAddress(entry) });
    });
  }

  renameAddress(index: number, label: string): Promise<Result<{ address: WalletAddress }>> {
    return this.exclusive(async () => {
      const trimmed = label.trim();
      if (trimmed.length < 1 || trimmed.length > MAX_LABEL_LENGTH) {
        return fail(Codes.invalidLabel, `A label has 1 to ${String(MAX_LABEL_LENGTH)} characters.`);
      }
      const opened = await this.requireKey();
      if (!opened.ok) return opened;
      const profile = await this.sessionProfile();
      if (profile === null) return fail(Codes.locked, 'The wallet is locked.');
      const target = profile.addresses.find((a) => a.index === index);
      if (!target) return fail(Codes.unknownAddress, 'No such address.');
      const renamed = { ...target, label: trimmed };
      const updated = await this.save(opened.value.key, {
        ...profile,
        addresses: profile.addresses.map((a) => (a.index === index ? renamed : a)),
      });
      if (!updated.ok) return updated;
      return ok({ address: toWalletAddress(renamed) });
    });
  }

  // ---- profile ----

  /** The decrypted profile; available while unlocked or weak locked. */
  async getProfile(): Promise<Result<Profile>> {
    const profile = await this.sessionProfile();
    return profile === null ? fail(Codes.locked, 'The wallet is locked.') : ok(profile);
  }

  /**
   * Applies `patch` to a copy of the profile, validates the result and re-seals it under the
   * session key. Needs the wallet unlocked (weak lock has no key): `needs-password`.
   */
  updateProfile(patch: (profile: Profile) => Profile): Promise<Result<Profile>> {
    return this.exclusive(async () => {
      const opened = await this.requireKey();
      if (!opened.ok) return opened;
      const current = await this.sessionProfile();
      if (current === null) return fail(Codes.locked, 'The wallet is locked.');
      return this.save(opened.value.key, patch(structuredClone(current)));
    });
  }

  // ---- signing seam ----

  /** Signs with the key of one of the wallet's own addresses; only while unlocked. */
  signDirect(address: string, signDoc: Uint8Array): Promise<Result<Uint8Array>> {
    return this.exclusive(() => this.signNow(address, signDoc));
  }

  private async signNow(address: string, signDoc: Uint8Array): Promise<Result<Uint8Array>> {
    const opened = await this.requireKey();
    if (!opened.ok) return opened;
    const { key, vault } = opened.value;
    const profile = await this.sessionProfile();
    const entry = profile?.addresses.find((a) => a.address === address);
    if (!entry) return fail(Codes.unknownAddress, 'No such address.');
    const signer = new LocalSigner(() => this.deps.vault.openMnemonic(key, vault));
    const signature = await signer.signDirect(entry.index, signDoc);
    await this.rearm();
    return ok(signature);
  }

  // ---- internals ----

  private async retryAt(): Promise<number | null> {
    const { lockedUntil } = await this.loadThrottle();
    return lockedUntil > this.deps.clock.now() ? lockedUntil : null;
  }

  private async loadThrottle(): Promise<ThrottleState> {
    const stored = await this.deps.storage.get(THROTTLE_KEY);
    if (stored === undefined) return { ...INITIAL_THROTTLE_STATE };
    if (validThrottle(stored)) return stored;
    // A damaged record must not hand out free guesses: fall back to the strictest lockout.
    const strict = {
      failures: CORRUPT_FAILURES,
      lockedUntil: this.deps.clock.now() + MAX_LOCKOUT_MS,
    };
    await this.deps.storage.set(THROTTLE_KEY, strict);
    return strict;
  }

  private async sessionKey(): Promise<Uint8Array | null> {
    return fromBase64(await this.deps.session.get(SESSION_KEY));
  }

  private async sessionProfile(): Promise<Profile | null> {
    const stored = await this.deps.session.get(SESSION_PROFILE);
    return validProfile(stored) ? stored : null;
  }

  private async requireKey(): Promise<Result<Opened>> {
    if ((await this.sessionProfile()) === null) {
      return fail(Codes.locked, 'The wallet is locked.');
    }
    const key = await this.sessionKey();
    if (key === null) return fail(Codes.needsPassword, 'Enter your password to continue.');
    const vault = await this.deps.storage.get(VAULT_KEY);
    if (!isRecord(vault)) return fail(Codes.vaultInvalid, 'The stored wallet is damaged.');
    return ok({ key, vault });
  }

  /** Checks the password through the throttle. A corrupt record is no wrong guess. */
  private async attempt(password: string): Promise<Result<Opened | Rejection>> {
    const stored = await this.deps.storage.get(VAULT_KEY);
    if (stored === undefined) return fail(Codes.uninitialised, 'There is no wallet yet.');
    if (!isRecord(stored)) return fail(Codes.vaultInvalid, 'The stored wallet is damaged.');
    const state = await this.loadThrottle();
    const now = this.deps.clock.now();
    if (state.lockedUntil > now) return ok({ status: 'throttled', retryAt: state.lockedUntil });
    try {
      const key = await this.deps.vault.unlock(password, stored);
      if (state.failures > 0 || state.lockedUntil > 0) await this.deps.storage.remove(THROTTLE_KEY);
      return ok({ key, vault: stored });
    } catch (e) {
      if (e instanceof WrongPasswordError) {
        const next = this.throttle.next(state, now, false);
        await this.deps.storage.set(THROTTLE_KEY, next.state);
        return ok({ status: 'wrong-password', retryAt: next.lockedUntil });
      }
      if (e instanceof InvalidRecordError) {
        return fail(Codes.vaultInvalid, 'The stored wallet is damaged.');
      }
      throw e;
    }
  }

  private async loadProfile(key: Uint8Array): Promise<Result<Profile>> {
    const record = await this.deps.storage.get(PROFILE_KEY);
    if (!isRecord(record)) return fail(Codes.profileInvalid, 'The stored wallet data is damaged.');
    try {
      const profile = await this.deps.vault.openProfile<unknown>(key, record);
      if (!validProfile(profile)) {
        return fail(Codes.profileInvalid, 'The stored wallet data is damaged.');
      }
      return ok(profile);
    } catch (e) {
      if (
        e instanceof InvalidRecordError ||
        e instanceof DecryptError ||
        e instanceof SyntaxError
      ) {
        return fail(Codes.profileInvalid, 'The stored wallet data is damaged.');
      }
      throw e;
    }
  }

  /** Validates, re-seals under K, then publishes to storage and session. */
  private async save(key: Uint8Array, next: Profile): Promise<Result<Profile>> {
    if (!validProfile(next)) {
      const settings = (next as { settings?: unknown } | null)?.settings;
      return validSettings(settings)
        ? fail(Codes.profileInvalid, 'The wallet data is not valid.')
        : fail(
            Codes.invalidSettings,
            'Lock times are whole minutes and the full lock is not before the weak lock.',
          );
    }
    const record = await this.deps.storage.get(PROFILE_KEY);
    if (!isRecord(record)) return fail(Codes.profileInvalid, 'The stored wallet data is damaged.');
    const sealed = await this.deps.vault.sealProfile(key, record, next);
    await this.deps.storage.set(PROFILE_KEY, sealed);
    await this.deps.session.set(SESSION_PROFILE, next);
    await this.rearm();
    return ok(next);
  }

  private checkNew(password: string, mnemonic: string, create: boolean): Result<string> {
    if (!passwordRules(password).ok) {
      return fail(Codes.passwordTooShort, 'The password needs at least 8 characters.');
    }
    const checked = validateMnemonic(mnemonic);
    if (!checked.ok || (create && checked.normalized.split(' ').length !== CREATE_WORDS)) {
      return fail(Codes.invalidMnemonic, 'This recovery phrase is not valid.');
    }
    return ok(checked.normalized);
  }

  private profileAddress(mnemonic: string, index: number): ProfileAddress {
    const account = deriveAccount(mnemonic, index);
    account.privKey.fill(0);
    return { index, label: defaultLabel(index), address: account.address };
  }

  /** Index 0 plus every of 0…4 that has a balance or an account; a failed lookup proves nothing. */
  private async detectAddresses(mnemonic: string): Promise<ProfileAddress[]> {
    const candidates = Array.from({ length: IMPORT_SCAN }, (_, i) =>
      this.profileAddress(mnemonic, i),
    );
    let chain: ChainClient | null = null;
    try {
      chain = await this.deps.chain();
    } catch {
      chain = null;
    }
    const used = await Promise.all(
      candidates.map(
        async (c) => c.index === 0 || (chain !== null && (await hasActivity(chain, c.address))),
      ),
    );
    return candidates.filter((_, i) => used[i]);
  }

  /** Replaces whatever was stored and leaves the wallet unlocked. */
  private async install(
    password: string,
    mnemonic: string,
    profile: Profile,
  ): Promise<Result<{ addresses: WalletAddress[] }>> {
    const created = await this.deps.vault.create(password, mnemonic, profile);
    try {
      await this.lockNow();
      await this.deps.storage.setMany({
        [VAULT_KEY]: created.vault,
        [PROFILE_KEY]: created.profile,
      });
      await this.deps.storage.remove(THROTTLE_KEY);
      await this.deps.session.set(SESSION_KEY, toBase64(created.key));
      await this.deps.session.set(SESSION_PROFILE, profile);
      await this.rearm();
    } finally {
      created.key.fill(0);
    }
    await this.notify();
    return ok({ addresses: profile.addresses.map(toWalletAddress) });
  }
}

function toWalletAddress(a: ProfileAddress): WalletAddress {
  return { index: a.index, label: a.label, address: a.address };
}

async function hasActivity(chain: ChainClient, address: string): Promise<boolean> {
  try {
    const balances = await chain.balances(address);
    if ([...balances.values()].some((v) => v > 0n)) return true;
  } catch {
    // unproven: fall through to the account lookup
  }
  try {
    return (await chain.account(address)) !== null;
  } catch {
    return false;
  }
}
