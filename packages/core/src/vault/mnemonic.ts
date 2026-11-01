import { entropyToMnemonic, validateMnemonic as bip39Validate } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { Random } from './crypto';

export type MnemonicCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: 'word-count' | 'unknown-word' | 'checksum' };

/**
 * Creates a new 24-word recovery phrase from 32 bytes of `random`.
 * The phrase is a plain string: callers must drop it as soon as it is no longer needed.
 */
export function createMnemonic(random: Random): string {
  const entropy = random.bytes(32);
  if (entropy.length !== 32) throw new Error('random source returned the wrong number of bytes');
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * Validates a recovery phrase (12 or 24 words, English list, checksum) after trimming,
 * lowercasing and collapsing whitespace.
 */
export function validateMnemonic(words: string): MnemonicCheck {
  const parts = words.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length !== 12 && parts.length !== 24) return { ok: false, reason: 'word-count' };
  const known = new Set(wordlist);
  if (!parts.every((w) => known.has(w))) return { ok: false, reason: 'unknown-word' };
  const normalized = parts.join(' ');
  if (!bip39Validate(normalized, wordlist)) return { ok: false, reason: 'checksum' };
  return { ok: true, normalized };
}
