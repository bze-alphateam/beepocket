// Control, format (zero-width, bidi, soft hyphen, FEFF, tag characters), private-use characters
// and the line and paragraph separators: none of them belong in text the user is asked to
// trust, and several change how neighbouring text reads.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}]/gu;

/** Text from an untrusted source with every unsafe character shown as U+FFFD, cut to `max`. */
export function sanitiseText(raw: string, max = Infinity): string {
  const clean = raw.replace(UNSAFE, '�');
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : clean;
}

/** The same characters removed, for display names that should not show a placeholder. */
export function stripUnsafeText(raw: string): string {
  return raw.replace(UNSAFE, '');
}
