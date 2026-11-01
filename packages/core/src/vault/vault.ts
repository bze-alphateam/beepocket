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

type Role = 'vault' | 'profile';

/** Upper bounds for the KDF parameters of a stored (untrusted) record. */
const MAX_M = 262144; // KiB (256 MiB)
const MAX_T = 10;
const MAX_P = 4;
const TAG_BYTES = 16;

interface DecodedRecord {
  salt: Uint8Array;
  nonce: Uint8Array;
  ct: Uint8Array;
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
    const salt = this.randomBytes(SALT_BYTES);
    const key = await this.kdf.derive(password, salt, this.params);
    const kdf = { ...this.params, salt: base64.encode(salt) };
    return {
      vault: await this.seal(key, 'vault', kdf, encoder.encode(mnemonic)),
      profile: await this.seal(key, 'profile', kdf, encoder.encode(JSON.stringify(profile))),
      key,
    };
  }

  /** Derives K and checks it against the vault. Throws {@link WrongPasswordError}. */
  async unlock(password: string, vault: EncryptedRecord): Promise<Uint8Array> {
    const { salt } = decodeRecord(vault);
    const key = await this.kdf.derive(password, salt, kdfParams(vault.kdf));
    try {
      await this.open(key, 'vault', vault);
    } catch (e) {
      if (e instanceof DecryptError) throw new WrongPasswordError();
      throw e;
    }
    return key;
  }

  async openMnemonic(key: Uint8Array, vault: EncryptedRecord): Promise<string> {
    return decoder.decode(await this.open(key, 'vault', vault));
  }

  async openProfile<T>(key: Uint8Array, record: EncryptedRecord): Promise<T> {
    return JSON.parse(decoder.decode(await this.open(key, 'profile', record))) as T;
  }

  /** Re-encrypts the profile under the same key, salt and parameters with a new nonce. */
  async sealProfile(
    key: Uint8Array,
    record: EncryptedRecord,
    profile: unknown,
  ): Promise<EncryptedRecord> {
    decodeRecord(record);
    return this.seal(key, 'profile', record.kdf, encoder.encode(JSON.stringify(profile)));
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

  private randomBytes(n: number): Uint8Array {
    const bytes = this.random.bytes(n);
    if (bytes.length !== n) throw new Error('random source returned the wrong number of bytes');
    return bytes;
  }

  private async seal(
    key: Uint8Array,
    role: Role,
    kdf: EncryptedRecord['kdf'],
    plain: Uint8Array,
  ): Promise<EncryptedRecord> {
    const nonce = this.randomBytes(NONCE_BYTES);
    const ct = await this.cipher.encrypt(key, nonce, plain, aad(role, kdf));
    return { v: 1, kdf: { ...kdf }, nonce: base64.encode(nonce), ct: base64.encode(ct) };
  }

  private async open(key: Uint8Array, role: Role, record: EncryptedRecord): Promise<Uint8Array> {
    const { nonce, ct } = decodeRecord(record);
    return this.cipher.decrypt(key, nonce, ct, aad(role, record.kdf));
  }
}

/**
 * Additional authenticated data: binds the record's role, format version and KDF parameters
 * (including the salt) to the ciphertext, so records cannot be swapped or re-parameterised.
 */
function aad(role: Role, kdf: EncryptedRecord['kdf']): Uint8Array {
  return encoder.encode(
    ['beepocket', 'v1', role, kdf.alg, kdf.m, kdf.t, kdf.p, kdf.salt].map(String).join('|'),
  );
}

function kdfParams(kdf: EncryptedRecord['kdf']): KdfParams {
  return { alg: kdf.alg, m: kdf.m, t: kdf.t, p: kdf.p };
}

function intInRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
}

function decodeBase64(s: unknown): Uint8Array {
  if (typeof s !== 'string') throw new InvalidRecordError();
  try {
    return base64.decode(s);
  } catch {
    throw new InvalidRecordError();
  }
}

/**
 * Stored data is untrusted: accept only a well-formed v1 record with bounded KDF parameters
 * (so a tampered record cannot force a huge Argon2 allocation) and valid base64 fields.
 */
function decodeRecord(record: EncryptedRecord): DecodedRecord {
  const { kdf } = record as Partial<EncryptedRecord> as { kdf?: EncryptedRecord['kdf'] };
  if ((record.v as number) !== 1 || !kdf || (kdf.alg as string) !== 'argon2id') {
    throw new InvalidRecordError();
  }
  if (
    !intInRange(kdf.p, 1, MAX_P) ||
    !intInRange(kdf.t, 1, MAX_T) ||
    !intInRange(kdf.m, 8 * kdf.p, MAX_M)
  ) {
    throw new InvalidRecordError();
  }
  const salt = decodeBase64(kdf.salt);
  const nonce = decodeBase64(record.nonce);
  const ct = decodeBase64(record.ct);
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || ct.length < TAG_BYTES) {
    throw new InvalidRecordError();
  }
  return { salt, nonce, ct };
}
