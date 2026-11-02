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

const WORDS = new Set(wordlist);

/** True when `word` is on the BIP-39 English list (case and surrounding spaces ignored). */
export function isMnemonicWord(word: string): boolean {
  return WORDS.has(word.trim().toLowerCase());
}

/** True when some word on the list starts with `prefix`: a word still being typed. */
export function isMnemonicPrefix(prefix: string): boolean {
  const p = prefix.trim().toLowerCase();
  return wordlist.some((w) => w.startsWith(p));
}

/** Levenshtein distance, giving up (returning `max + 1`) once it is past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * The list word closest to a mistyped `word`, at most two edits away, or null. A typo rarely
 * hits the first letter, so a word with the same first letter wins a tie; then list order does.
 */
export function suggestMnemonicWord(word: string): string | null {
  const w = word.trim().toLowerCase();
  if (w === '' || WORDS.has(w)) return null;
  let found: string | null = null;
  let best = Infinity;
  for (const candidate of wordlist) {
    const d = distance(w, candidate, 2);
    if (d > 2) continue;
    const score = d * 2 + (candidate[0] === w[0] ? 0 : 1);
    if (score < best) {
      best = score;
      found = candidate;
      if (score === 2) break;
    }
  }
  return found;
}
