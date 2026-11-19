import { stripUnsafeText } from './text';

/**
 * Token look-alikes.
 *
 * Anyone can create a token and give it any symbol, so the symbol alone never proves which token
 * it is. The rule the wallet applies everywhere a token is named:
 *
 * 1. Only the native denom (`ubze`) may read as BZE / BeeZee. Any other token whose symbol or
 *    name folds to the same form as `BZE` or `BeeZee` is a look-alike, verified or not.
 * 2. A token that is not on the verified list (BZE Scan's registry `verified` flag) and whose
 *    symbol folds to the same form as a verified token's symbol is a look-alike.
 * 3. Every other token keeps its plain symbol.
 *
 * A look-alike is shown with a marker and a short form of its denom.
 *
 * Folding (`foldConfusable`), in this order:
 * 1. drop control, format (zero-width, bidi), private-use and separator characters;
 * 2. NFKC, so fullwidth, mathematical and other compatibility forms become plain letters, then
 *    NFD with combining marks dropped, so accented letters become their base letter;
 * 3. the `CONFUSABLES` map below: Greek, Cyrillic and small-capital letters that look Latin;
 * 4. lower case;
 * 5. `l`, `i`, `1` and `|` read alike, as do `o` and `0`;
 * 6. spaces and punctuation dropped (`B.Z.E` reads as `BZE`).
 *
 * Two texts look alike when their folded forms are equal and not empty. The map is small on
 * purpose: it covers the letters that pass for Latin in a token symbol, not all of Unicode.
 */

/** Letters that look like a Latin letter, as that letter. Both cases are listed. */
// prettier-ignore
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Greek capitals
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P',
  Τ: 'T', Υ: 'Y', Χ: 'X',
  // Greek small letters
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ϲ: 'c',
  // Cyrillic capitals
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y',
  Х: 'X', Ѕ: 'S', І: 'I', Ј: 'J', Ԛ: 'Q', Ԝ: 'W', Ү: 'Y',
  // Cyrillic small letters
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', ѕ: 's', і: 'i', ј: 'j', һ: 'h',
  ԁ: 'd', ԛ: 'q', ԝ: 'w', ү: 'y', к: 'k',
  // Latin small capitals
  ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l',
  ᴍ: 'm', ɴ: 'n', ᴏ: 'o', ᴘ: 'p', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y',
  ᴢ: 'z',
  // Dotless i
  ı: 'i',
};

/** After lower-casing: characters that read as the same letter in most fonts. */
const SAME_SHAPE: Readonly<Record<string, string>> = { i: 'l', '1': 'l', '|': 'l', '0': 'o' };

const COMBINING_MARKS = /\p{M}/gu;
/** Spaces, punctuation and symbols: they separate letters without changing what a symbol reads as. */
const SEPARATORS = /[\p{Z}\p{P}\p{S}]/gu;

/** The form two texts share when they look alike; see the rule at the top of this file. */
export function foldConfusable(text: string): string {
  const plain = stripUnsafeText(text)
    .normalize('NFKC')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '');
  let mapped = '';
  for (const ch of plain) mapped += CONFUSABLES[ch] ?? ch;
  let folded = '';
  for (const ch of mapped.toLowerCase()) folded += SAME_SHAPE[ch] ?? ch;
  return folded.replace(SEPARATORS, '');
}

/** Whether two texts look alike: equal folded forms, and not empty. */
export function sameLook(a: string, b: string): boolean {
  const folded = foldConfusable(a);
  return folded !== '' && folded === foldConfusable(b);
}

/** A verified token, as the look-alike check needs it. */
export interface VerifiedAsset {
  denom: string;
  symbol: string;
}

const NATIVE_DENOM = 'ubze';
const NATIVE_FORMS = new Set(['BZE', 'BeeZee'].map(foldConfusable));

/** Rules 1 and 2 at the top of this file. */
export function isLookalike(
  token: { denom: string; symbol: string; name: string },
  verified: readonly VerifiedAsset[],
): boolean {
  if (token.denom === NATIVE_DENOM) return false;
  const symbol = foldConfusable(token.symbol);
  if (NATIVE_FORMS.has(symbol) || NATIVE_FORMS.has(foldConfusable(token.name))) return true;
  if (symbol === '' || verified.some((v) => v.denom === token.denom)) return false;
  return verified.some((v) => v.denom !== NATIVE_DENOM && foldConfusable(v.symbol) === symbol);
}

/** How a token is named on screen. The UI decides the styling of the marker and the tail. */
export interface TokenLabel {
  /** The symbol, cleaned and bounded. */
  symbol: string;
  /** A short form of the denom, shown next to a look-alike; null otherwise. */
  tail: string | null;
  lookalike: boolean;
}

const MAX_LABEL_SYMBOL = 32;
const MAX_TAIL_PART = 12;

function shorten(text: string, head: number, tail: number): string {
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${tail === 0 ? '' : text.slice(-tail)}`;
}

/** `factory/bze1qq…qqqq/fake`, `ibc/27E9…5EB2`: enough of a denom to tell tokens apart. */
export function denomTail(denom: string): string {
  const clean = stripUnsafeText(denom);
  const parts = clean.split('/');
  if (parts[0] === 'factory' && parts.length >= 3) {
    const creator = parts[1] ?? '';
    const sub = parts.slice(2).join('/');
    return `factory/${shorten(creator, 6, 4)}/${shorten(sub, MAX_TAIL_PART - 1, 0)}`;
  }
  if (parts[0] === 'ibc' && parts.length === 2) return `ibc/${shorten(parts[1] ?? '', 4, 4)}`;
  return shorten(clean, 16, 6);
}

/** Untrusted display text without unsafe characters, trimmed, cut to `max` characters. */
export function cleanLabel(raw: string, max: number): string {
  const chars = Array.from(stripUnsafeText(raw).trim());
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/** The label of a token whose `lookalike` flag is already known (`TokenResolver` sets it). */
export function tokenLabel(token: {
  denom: string;
  symbol: string;
  lookalike?: boolean | undefined;
}): TokenLabel {
  const lookalike = token.lookalike === true;
  const symbol = cleanLabel(token.symbol, MAX_LABEL_SYMBOL);
  return { symbol, tail: lookalike ? denomTail(token.denom) : null, lookalike };
}

/** The label as plain text: `GOLD`, or `BZE (look-alike, factory/bze1x/fake)`. */
export function labelText(label: TokenLabel): string {
  return label.lookalike ? `${label.symbol} (look-alike, ${label.tail ?? ''})` : label.symbol;
}
