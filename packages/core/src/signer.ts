import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { deriveAccount } from './vault/keys';

/** Signs transactions for the wallet's accounts. A Ledger is a later implementation. */
export interface Signer {
  /** 33-byte compressed secp256k1 public key of account `index`. */
  pubKey(index: number): Promise<Uint8Array>;
  /** 64-byte compact (r‖s), low-S signature over `sha256(signDoc)`. */
  signDirect(index: number, signDoc: Uint8Array): Promise<Uint8Array>;
}

/**
 * Signs with keys derived from the recovery phrase. The phrase is requested from
 * `mnemonicProvider` for every call and no reference is kept afterwards.
 */
export class LocalSigner implements Signer {
  constructor(private readonly mnemonicProvider: () => Promise<string>) {}

  async pubKey(index: number): Promise<Uint8Array> {
    const account = deriveAccount(await this.mnemonicProvider(), index);
    account.privKey.fill(0);
    return account.pubKey;
  }

  async signDirect(index: number, signDoc: Uint8Array): Promise<Uint8Array> {
    const account = deriveAccount(await this.mnemonicProvider(), index);
    try {
      return secp256k1.sign(sha256(signDoc), account.privKey, { prehash: false, lowS: true });
    } finally {
      account.privKey.fill(0);
    }
  }
}
