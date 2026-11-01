export interface PasswordRules {
  /** True when the password is long enough to be accepted. */
  ok: boolean;
  /** A rough hint (length and character classes) for the UI, not a security guarantee. */
  strength: 0 | 1 | 2 | 3 | 4;
}

export const MIN_PASSWORD_LENGTH = 8;

export function passwordRules(pw: string): PasswordRules {
  const length = Array.from(pw).length;
  if (length < MIN_PASSWORD_LENGTH) return { ok: false, strength: 0 };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) => re.test(pw)).length;
  const score = 1 + (length >= 12 ? 1 : 0) + (length >= 16 ? 1 : 0) + (classes >= 3 ? 1 : 0);
  return { ok: true, strength: Math.min(score, 4) as PasswordRules['strength'] };
}
