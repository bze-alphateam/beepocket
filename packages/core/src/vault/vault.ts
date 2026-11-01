import { base64 } from '@scure/base';
import {
  DEFAULT_KDF_PARAMS,
  NONCE_BYTES,
  SALT_BYTES,
  type Cipher,
  type Kdf,
  type KdfParams,
  type Random,
} from './crypto';
import { DecryptError, InvalidRecordError, WrongPasswordError } from './errors';

/** An encrypted blob with everything needed (except the password) to open it. */
export interface EncryptedRecord {
  v: 1;
  kdf: KdfParams & { salt: string };
  nonce: string;
  ct: string;
}

export interface VaultDeps {
  random: Random;
  cipher: Cipher;
  kdf: Kdf;
  /** KDF parameters for newly created records. Defaults to Argon2id m=64 MiB, t=3, p=1. */
  params?: KdfParams;
}

export interface CreatedVault {
  vault: EncryptedRecord;
  profile: EncryptedRecord;
  /** The derived key K. Callers keep it only while unlocked and drop it afterwards. */
  key: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * The password-encrypted storage of the recovery phrase (`vault`) and the wallet data
 * (`profile`). One salt and one key K per password; every encryption uses a fresh nonce.
 *
 * Mnemonics, passwords and keys are plain strings / byte arrays: callers should drop
 * them as soon as they are no longer needed. Nothing is logged.
 */
export class Vault {
  private readonly random: Random;
  private readonly cipher: Cipher;
  private readonly kdf: Kdf;
  private readonly params: KdfParams;

  constructor(deps: VaultDeps) {
    this.random = deps.random;
    this.cipher = deps.cipher;
    this.kdf = deps.kdf;
    this.params = deps.params ?? DEFAULT_KDF_PARAMS;
  }

  async create(password: string, mnemonic: string, profile: unknown): Promise<CreatedVault> {
    const salt = this.random.bytes(SALT_BYTES);
    const key = await this.kdf.derive(password, salt, this.params);
    const kdf = { ...this.params, salt: base64.encode(salt) };
    return {
      vault: await this.seal(key, kdf, encoder.encode(mnemonic)),
      profile: await this.seal(key, kdf, encoder.encode(JSON.stringify(profile))),
      key,
    };
  }

  /** Derives K and checks it against the vault. Throws {@link WrongPasswordError}. */
  async unlock(password: string, vault: EncryptedRecord): Promise<Uint8Array> {
    const { kdf } = checkRecord(vault);
    const key = await this.kdf.derive(password, base64.decode(kdf.salt), kdfParams(kdf));
    try {
      await this.open(key, vault);
    } catch (e) {
      if (e instanceof DecryptError) throw new WrongPasswordError();
      throw e;
    }
    return key;
  }

  async openMnemonic(key: Uint8Array, vault: EncryptedRecord): Promise<string> {
    return decoder.decode(await this.open(key, vault));
  }

  async openProfile<T>(key: Uint8Array, record: EncryptedRecord): Promise<T> {
    return JSON.parse(decoder.decode(await this.open(key, record))) as T;
  }

  /** Re-encrypts the profile under the same key, salt and parameters with a new nonce. */
  async sealProfile(
    key: Uint8Array,
    record: EncryptedRecord,
    profile: unknown,
  ): Promise<EncryptedRecord> {
    return this.seal(key, checkRecord(record).kdf, encoder.encode(JSON.stringify(profile)));
  }

  /** Re-encrypts both records under `newPassword` with a new salt and the current default parameters. */
  async changePassword(
    oldPassword: string,
    newPassword: string,
    vault: EncryptedRecord,
    profile: EncryptedRecord,
  ): Promise<CreatedVault> {
    const oldKey = await this.unlock(oldPassword, vault);
    const mnemonic = await this.openMnemonic(oldKey, vault);
    const data = await this.openProfile<unknown>(oldKey, profile);
    return this.create(newPassword, mnemonic, data);
  }

  private async seal(
    key: Uint8Array,
    kdf: EncryptedRecord['kdf'],
    plain: Uint8Array,
  ): Promise<EncryptedRecord> {
    const nonce = this.random.bytes(NONCE_BYTES);
    const ct = await this.cipher.encrypt(key, nonce, plain);
    return { v: 1, kdf: { ...kdf }, nonce: base64.encode(nonce), ct: base64.encode(ct) };
  }

  private async open(key: Uint8Array, record: EncryptedRecord): Promise<Uint8Array> {
    checkRecord(record);
    return this.cipher.decrypt(key, base64.decode(record.nonce), base64.decode(record.ct));
  }
}

function kdfParams(kdf: EncryptedRecord['kdf']): KdfParams {
  return { alg: kdf.alg, m: kdf.m, t: kdf.t, p: kdf.p };
}

function checkRecord(record: EncryptedRecord): EncryptedRecord {
  const { kdf } = record;
  // Stored data is untrusted: reject anything that is not a well-formed v1 record.
  const ok =
    (record.v as number) === 1 &&
    (kdf.alg as string) === 'argon2id' &&
    [kdf.m, kdf.t, kdf.p].every((n) => Number.isInteger(n) && n > 0) &&
    typeof kdf.salt === 'string' &&
    typeof record.nonce === 'string' &&
    typeof record.ct === 'string';
  if (!ok) throw new InvalidRecordError();
  return record;
}
