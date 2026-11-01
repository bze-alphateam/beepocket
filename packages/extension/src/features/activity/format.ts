import { formatAmount, type TokenInfo } from '@beepocket/core';
import type { ActivityAmount } from '../../protocol';

/** "+1.5", "−0.02"; a zero change shows no sign. */
export function signedAmount(base: string, decimals: number): string {
  const n = BigInt(base);
  if (n === 0n) return formatAmount(0n, decimals);
  return `${n < 0n ? '−' : '+'}${formatAmount(n < 0n ? -n : n, decimals)}`;
}

/** "14:05 · 31 Oct", in the browser's local time and language. */
export function whenText(iso: string, locale?: string | string[]): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const hour = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at);
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at);
  return `${hour} · ${date}`;
}

/** "factory/bze1abc…wxyz/token" → "factory/…/token"; short denoms stay as they are. */
function shortDenom(denom: string): string {
  const parts = denom.split('/');
  if (parts.length < 3) return denom.length > 16 ? `${denom.slice(0, 15)}…` : denom;
  return `${parts[0] ?? ''}/…/${parts.slice(2).join('/')}`;
}

/**
 * "+1.5 BZE", "−0.02 PAGE" for one change: Scan's symbol and exponent first, then the wallet's
 * own knowledge of the token, else the shortened denom with the base units as they are.
 */
export function amountText(
  amount: ActivityAmount,
  known: readonly Pick<TokenInfo, 'denom' | 'symbol' | 'decimals'>[] = [],
): string {
  const info = known.find((k) => k.denom === amount.denom);
  const symbol = amount.symbol ?? info?.symbol ?? shortDenom(amount.denom);
  const decimals = amount.exponent ?? info?.decimals ?? 0;
  return `${signedAmount(amount.amount, decimals)} ${symbol}`;
}
