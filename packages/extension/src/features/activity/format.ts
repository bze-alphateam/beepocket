import { formatAmount } from '@beepocket/core';

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
