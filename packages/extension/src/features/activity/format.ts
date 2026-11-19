import { denomTail, formatAmount, type TokenInfo } from '@beepocket/core';
import type { ActivityAmount } from '../../protocol';

/** "+1.5", "−0.02"; a zero change shows no sign. */
export function signedAmount(base: string, decimals: number): string {
  const n = BigInt(base);
  if (n === 0n) return formatAmount(0n, decimals);
  return `${n < 0n ? '−' : '+'}${formatAmount(n < 0n ? -n : n, decimals)}`;
}

/** "14:05 · 31 Oct": 24-hour time, then day and short month, in the browser's local time. */
export function whenText(iso: string, locale?: string | string[]): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const hour = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  // Day before month whatever the language's own order ("31 Oct", never "Oct 31").
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).formatToParts(
    at,
  );
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${hour} · ${day} ${month}`;
}

/** The unknown-token forms: `ibc/6490…9E0F`, `factory/…/name`; any other denom stays whole. */
export function shortDenom(denom: string): string {
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
  /** Set only for a symbol that imitates BZE or a verified token: shown with a marker. */
  lookalike?: true;
  /** With `lookalike`: a short form of the denom, to tell it from the real token. */
  tail?: string;
}

type KnownToken = Pick<TokenInfo, 'denom' | 'symbol' | 'decimals'> &
  Partial<Pick<TokenInfo, 'source' | 'lookalike'>>;

/**
 * The wallet's own data for a token it knows first (its label is checked for look-alikes), then
 * Scan's symbol and exponent; a token with no chain data has no decimals, so its amount is the
 * raw integer with thousands separators.
 */
export function amountParts(
  amount: ActivityAmount,
  known: readonly KnownToken[] = [],
): AmountParts {
  const found = known.find((k) => k.denom === amount.denom);
  // A placeholder the wallet guessed from the denom knows less than Scan.
  const info = found?.source === 'fallback' ? undefined : found;
  const symbol = info?.symbol ?? amount.symbol ?? null;
  const decimals = info ? info.decimals : (amount.exponent ?? 0);
  const lookalike = info ? info.lookalike === true : amount.lookalike === true;
  return {
    value: signedAmount(amount.amount, decimals),
    symbol: symbol ?? shortDenom(amount.denom),
    denom: amount.denom,
    unknown: symbol === null,
    ...(lookalike ? { lookalike: true as const, tail: denomTail(amount.denom) } : {}),
  };
}

/** "+1.5 BZE", "−0.02 PAGE" for one change; an unknown token reads "+1,250 ibc/6490…9E0F". */
export function amountText(amount: ActivityAmount, known: readonly KnownToken[] = []): string {
  const p = amountParts(amount, known);
  return `${p.value} ${p.symbol}`;
}
