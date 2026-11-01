import { argon2idAsync } from '@noble/hashes/argon2.js';
import { DecryptError } from './errors';

/** Source of cryptographically secure random bytes. */
export interface Random {
  bytes(n: number): Uint8Array;
}

/** AES-256-GCM. `decrypt` throws {@link DecryptError} when authentication fails. */
export interface Cipher {
  encrypt(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Promise<Uint8Array>;
  decrypt(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array): Promise<Uint8Array>;
}

/** Argon2id parameters: `m` in KiB, `t` iterations, `p` lanes. */
export interface KdfParams {
  alg: 'argon2id';
  m: number;
  t: number;
  p: number;
}

/** Derives a 32-byte key from a password. */
export interface Kdf {
  derive(password: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array>;
}

export const DEFAULT_KDF_PARAMS: KdfParams = { alg: 'argon2id', m: 65536, t: 3, p: 1 };

export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;

/** AES-256-GCM on top of an injected WebCrypto `SubtleCrypto`. */
export class WebCryptoCipher implements Cipher {
  constructor(private readonly subtle: SubtleCrypto) {}

  async encrypt(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
    const k = await this.importKey(key, 'encrypt');
    const ct = await this.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      k,
      plain as BufferSource,
    );
    return new Uint8Array(ct);
  }

  async decrypt(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array): Promise<Uint8Array> {
    const k = await this.importKey(key, 'decrypt');
    try {
      const plain = await this.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource },
        k,
        ct as BufferSource,
      );
      return new Uint8Array(plain);
    } catch {
      throw new DecryptError();
    }
  }

  private importKey(key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
    return this.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [usage]);
  }
}

/** Argon2id (`@noble/hashes`), async so the UI thread stays responsive. 32-byte output. */
export class Argon2idKdf implements Kdf {
  derive(password: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
    return argon2idAsync(password, salt, {
      m: params.m,
      t: params.t,
      p: params.p,
      dkLen: KEY_BYTES,
    });
  }
}
