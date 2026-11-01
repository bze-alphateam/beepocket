import { describe, expect, it } from 'vitest';
import {
  Argon2idKdf,
  DecryptError,
  WebCryptoCipher,
  WrongPasswordError,
  Vault,
  type EncryptedRecord,
  type Kdf,
  type KdfParams,
  type Random,
} from '../index';

/** Deterministic but never-repeating bytes. */
function counterRandom(): Random {
  let n = 0;
  return {
    bytes(len) {
      n++;
      return Uint8Array.from({ length: len }, (_, i) => (n * 31 + i * 7) % 256);
    },
  };
}

const fast: KdfParams = { alg: 'argon2id', m: 8, t: 1, p: 1 };
const cipher = new WebCryptoCipher(globalThis.crypto.subtle);
const mnemonic = `${'abandon '.repeat(23)}art`;
const profile = { labels: { 0: 'Main' }, network: 'mainnet' };

function makeVault(params: KdfParams = fast, kdf: Kdf = new Argon2idKdf()) {
  return new Vault({ random: counterRandom(), cipher, kdf, params });
}

function tamper(record: EncryptedRecord): EncryptedRecord {
  const ct = Buffer.from(record.ct, 'base64');
  ct[0] = (ct[0] ?? 0) ^ 1;
  return { ...record, ct: ct.toString('base64') };
}

describe('Argon2idKdf', () => {
  // Reference value computed with OpenSSL's Argon2id (node:crypto argon2Sync):
  // password "correct horse battery staple", salt 16 x 0x07, m=64 KiB, t=3, p=1, 32 bytes.
  it('matches a reference implementation', async () => {
    const key = await new Argon2idKdf().derive(
      'correct horse battery staple',
      new Uint8Array(16).fill(7),
      {
        alg: 'argon2id',
        m: 64,
        t: 3,
        p: 1,
      },
    );
    expect(Buffer.from(key).toString('hex')).toBe(
      '42e698046d9cee51214f7eb6a61264706d24c6cfc67183d3c20a15db0bcd5fc2',
    );
  });
});

describe('Vault', () => {
  it('round trips mnemonic and profile', async () => {
    const vault = makeVault();
    const created = await vault.create('hunter2hunter2', mnemonic, profile);
    const key = await vault.unlock('hunter2hunter2', created.vault);
    expect(key).toEqual(created.key);
    expect(await vault.openMnemonic(key, created.vault)).toBe(mnemonic);
    expect(await vault.openProfile(key, created.profile)).toEqual(profile);
  });

  it('stores the default parameters, one salt and distinct nonces', async () => {
    const stub: Kdf = { derive: () => Promise.resolve(new Uint8Array(32).fill(5)) };
    const created = await makeVault({ alg: 'argon2id', m: 65536, t: 3, p: 1 }, stub).create(
      'pw',
      mnemonic,
      profile,
    );
    const defaults = await new Vault({ random: counterRandom(), cipher, kdf: stub }).create(
      'pw',
      mnemonic,
      profile,
    );
    for (const c of [created, defaults]) {
      expect(c.vault.v).toBe(1);
      expect(c.vault.kdf).toMatchObject({ alg: 'argon2id', m: 65536, t: 3, p: 1 });
      expect(Buffer.from(c.vault.kdf.salt, 'base64')).toHaveLength(16);
      expect(c.profile.kdf.salt).toBe(c.vault.kdf.salt);
      expect(Buffer.from(c.vault.nonce, 'base64')).toHaveLength(12);
      expect(c.profile.nonce).not.toBe(c.vault.nonce);
    }
  });

  it('rejects a wrong password', async () => {
    const vault = makeVault();
    const created = await vault.create('right-password', mnemonic, profile);
    await expect(vault.unlock('wrong-password', created.vault)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it('seals the profile with a new nonce every time', async () => {
    const vault = makeVault();
    const created = await vault.create('pw-pw-pw-pw', mnemonic, profile);
    const a = await vault.sealProfile(created.key, created.profile, profile);
    const b = await vault.sealProfile(created.key, created.profile, profile);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ct).not.toBe(b.ct);
    expect(a.kdf).toEqual(created.profile.kdf);
    expect(await vault.openProfile(created.key, b)).toEqual(profile);
  });

  it('detects tampered ciphertext', async () => {
    const vault = makeVault();
    const created = await vault.create('pw-pw-pw-pw', mnemonic, profile);
    await expect(vault.openMnemonic(created.key, tamper(created.vault))).rejects.toBeInstanceOf(
      DecryptError,
    );
    await expect(vault.openProfile(created.key, tamper(created.profile))).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it('rejects malformed records', async () => {
    const vault = makeVault();
    const created = await vault.create('pw-pw-pw-pw', mnemonic, profile);
    const bad = { ...created.vault, v: 2 } as unknown as EncryptedRecord;
    await expect(vault.unlock('pw-pw-pw-pw', bad)).rejects.toThrow('invalid encrypted record');
  });

  it('changes the password with a new salt', async () => {
    const vault = makeVault();
    const created = await vault.create('old-password', mnemonic, profile);
    const changed = await vault.changePassword(
      'old-password',
      'new-password',
      created.vault,
      created.profile,
    );
    expect(changed.vault.kdf.salt).not.toBe(created.vault.kdf.salt);
    const key = await vault.unlock('new-password', changed.vault);
    expect(await vault.openMnemonic(key, changed.vault)).toBe(mnemonic);
    expect(await vault.openProfile(key, changed.profile)).toEqual(profile);
    await expect(vault.unlock('old-password', changed.vault)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it('refuses to change the password when the old one is wrong', async () => {
    const vault = makeVault();
    const created = await vault.create('old-password', mnemonic, profile);
    await expect(
      vault.changePassword('nope-nope', 'new-password', created.vault, created.profile),
    ).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
