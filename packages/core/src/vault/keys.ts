import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

export const BZE_PREFIX = 'bze';

export interface Account {
  index: number;
  address: string;
  /** 33-byte compressed secp256k1 public key. */
  pubKey: Uint8Array;
  /** 32-byte private key. Callers must drop it after use. */
  privKey: Uint8Array;
}

/** Derives the account at `m/44'/118'/0'/0/{index}` from a (validated) recovery phrase. */
export function deriveAccount(mnemonic: string, index: number): Account {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) {
    throw new RangeError('account index out of range');
  }
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(
    `m/44'/118'/0'/0/${String(index)}`,
  );
  if (!node.privateKey || !node.publicKey) throw new Error('key derivation failed');
  const hash = ripemd160(sha256(node.publicKey));
  return {
    index,
    address: bech32.encode(BZE_PREFIX, bech32.toWords(hash)),
    pubKey: node.publicKey,
    privKey: node.privateKey,
  };
}

/** True for a valid bech32 `bze1…` address carrying a 20-byte hash. */
export function isBzeAddress(s: string): boolean {
  try {
    const { prefix, words } = bech32.decode(s as `${string}1${string}`);
    return prefix === BZE_PREFIX && bech32.fromWords(words).length === 20;
  } catch {
    return false;
  }
}

/** First 8 characters, an ellipsis and the last 6 characters, e.g. `bze1q8t5…y4x4kf`. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}
