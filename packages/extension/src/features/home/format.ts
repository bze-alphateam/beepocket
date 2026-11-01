import { formatAmount } from '@beepocket/core';
import { t } from '../../i18n';
import type { AddressBalance } from '../../protocol';

export function amountText(amount: string, decimals: number): string {
  return formatAmount(BigInt(amount), decimals);
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
