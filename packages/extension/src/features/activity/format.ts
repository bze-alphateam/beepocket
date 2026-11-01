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

/** The unknown-token forms: `ibc/6490…9E0F`, `factory/…/name`; any other denom stays whole. */
function shortDenom(denom: string): string {
  if (denom.startsWith('ibc/')) {
    const hash = denom.slice(4);
    return hash.length <= 8 ? denom : `ibc/${hash.slice(0, 4)}…${hash.slice(-4)}`;
  }
  const parts = denom.split('/');
  if (parts[0] === 'factory' && parts.length >= 3) {
    const name = parts.slice(2).join('/');
    return `factory/…/${name.length > 10 ? `${name.slice(0, 9)}…` : name}`;
  }
  return denom;
}

/** One change split for display: the signed amount, the symbol, and whether the token is known. */
export interface AmountParts {
  value: string;
  symbol: string;
  /** The full denom, for the hover title of an unknown token's short symbol. */
  denom: string;
  /** Neither Scan nor the wallet knows the token: raw base units, shortened denom. */
  unknown: boolean;
}

/**
 * Scan's symbol and exponent first, then the wallet's own knowledge of the token; a token with
 * no chain data has no decimals, so its amount is the raw integer with thousands separators.
 */
export function amountParts(
  amount: ActivityAmount,
  known: readonly Pick<TokenInfo, 'denom' | 'symbol' | 'decimals'>[] = [],
): AmountParts {
  const info = known.find((k) => k.denom === amount.denom);
  const symbol = amount.symbol ?? info?.symbol ?? null;
  const decimals = amount.exponent ?? info?.decimals ?? 0;
  return {
    value: signedAmount(amount.amount, decimals),
    symbol: symbol ?? shortDenom(amount.denom),
    denom: amount.denom,
    unknown: symbol === null,
  };
}

/** "+1.5 BZE", "−0.02 PAGE" for one change; an unknown token reads "+1,250 ibc/6490…9E0F". */
export function amountText(
  amount: ActivityAmount,
  known: readonly Pick<TokenInfo, 'denom' | 'symbol' | 'decimals'>[] = [],
): string {
  const p = amountParts(amount, known);
  return `${p.value} ${p.symbol}`;
}
