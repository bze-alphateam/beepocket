/** Authenticated decryption failed: wrong key, wrong nonce or tampered ciphertext. */
export class DecryptError extends Error {
  constructor() {
    super('decryption failed');
    this.name = 'DecryptError';
  }
}

/** The password did not open the vault. */
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password');
    this.name = 'WrongPasswordError';
  }
}

/** A stored record has an unknown version or malformed fields. */
export class InvalidRecordError extends Error {
  constructor() {
    super('invalid encrypted record');
    this.name = 'InvalidRecordError';
  }
}
