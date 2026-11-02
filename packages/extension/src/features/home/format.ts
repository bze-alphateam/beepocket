import { formatAmount, type DenomBranding } from '@beepocket/core';
import { t } from '../../i18n';
import type { AddressBalance, ListedToken } from '../../protocol';
import { resolveKit } from '../../theme';

/** An empty balance is a plain "0", as on the boards. */
export function amountText(amount: string, decimals: number): string {
  const n = BigInt(amount);
  return n === 0n ? '0' : formatAmount(n, decimals);
}

export function holds(a: AddressBalance): boolean {
  return a.failed !== true && BigInt(a.amount) > 0n;
}

/** Business Logic §5: "across N" when every address holds it, "none of" when none does. */
export function subline(all: AddressBalance[]): string {
  // Addresses that could not be read are unknown, not empty: leave them out of the counts.
  const addresses = all.filter((a) => a.failed !== true);
  const count = addresses.length;
  const held = addresses.filter(holds).length;
  if (held === 0) return t('home.sub.none', { count });
  if (held === count) return count === 1 ? t('home.sub.all.one') : t('home.sub.all', { count });
  return t('home.sub.some', { held, count });
}

/**
 * A token's own colour for its avatar: the primary of its dark kit (or BZE blue), in both schemes
 * and whatever the theme setting, as on the boards. `branding` overrides the list's copy when the
 * screen fetched a fresher one.
 */
export function tokenColor(
  token: ListedToken,
  branding: DenomBranding | null = token.branding,
): string {
  return resolveKit({ denom: token.denom, branding, brandThemes: true }, 'dark').primary;
}
