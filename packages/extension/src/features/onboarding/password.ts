export const MIN_PASSWORD_LENGTH = 8;

export type Strength = 'weak' | 'fair' | 'strong';

/** Length and character classes only; a hint, never a gate beyond the minimum length. */
export function strengthOf(password: string): Strength {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) =>
    r.test(password),
  ).length;
  if (password.length < MIN_PASSWORD_LENGTH || classes < 2) return 'weak';
  if (password.length >= 12 && classes >= 3) return 'strong';
  return 'fair';
}
