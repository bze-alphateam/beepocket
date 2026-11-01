/** Largest decimals value accepted; matches the exponent bound of the network clients. */
const MAX_DECIMALS = 18;
/** Longest amount or price string looked at; longer input is not a real amount. */
const MAX_INPUT_LENGTH = 100;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS)
    throw new RangeError(`decimals must be an integer between 0 and ${String(MAX_DECIMALS)}`);
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Base units as a display string: `1,000.00`. At least two fraction digits when
 * the token has them, trailing zeros beyond that trimmed, at most `maxFraction`
 * digits (default 6). Digits past `maxFraction` are cut off, never rounded up,
 * so the display never shows more than the balance holds.
 */
export function formatAmount(
  base: bigint,
  decimals: number,
  options: { maxFraction?: number } = {},
): string {
  assertDecimals(decimals);
  const maxFraction = options.maxFraction ?? 6;
  if (!Number.isInteger(maxFraction) || maxFraction < 0)
    throw new RangeError('maxFraction must be a non-negative integer');

  const negative = base < 0n;
  const digits = (negative ? -base : base).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);

  const shown = Math.min(decimals, maxFraction);
  const trimmed = fraction.slice(0, shown).replace(/0+$/, '');
  const padded = trimmed.padEnd(Math.min(2, shown), '0');
  return `${negative ? '-' : ''}${groupThousands(whole)}${padded === '' ? '' : `.${padded}`}`;
}

/**
 * Parses what a user typed (`12`, `0.5`, `1000.25`) into base units. Plain
 * decimal notation only: no sign, exponent, separators or surrounding spaces,
 * and no more fraction digits than the token has.
 */
export function parseAmount(display: string, decimals: number): bigint | Error {
  assertDecimals(decimals);
  if (display.length === 0) return new Error('amount is empty');
  if (display.length > MAX_INPUT_LENGTH) return new Error('amount is too long');
  if (display.startsWith('-')) return new Error('amount cannot be negative');
  if (/e/i.test(display)) return new Error('exponent notation is not supported');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(display);
  if (!match) return new Error('amount must be a plain decimal number');
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > decimals)
    return new Error(`at most ${String(decimals)} decimal places are allowed`);
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

/**
 * A chain price (quote base units per base base-unit) as a display price:
 * `uPrice × 10^(baseDecimals − quoteDecimals)`, the same conversion as the
 * dapps' `uPriceToPrice`. The shift is exact (decimal point move on the string),
 * the result is plain notation with trailing zeros trimmed, never exponent form.
 */
export function displayPrice(uPrice: string, baseDecimals: number, quoteDecimals: number): string {
  assertDecimals(baseDecimals);
  assertDecimals(quoteDecimals);
  if (uPrice.length > MAX_INPUT_LENGTH || !/^\d+(\.\d+)?$/.test(uPrice))
    throw new RangeError('price must be a non-negative plain decimal string');

  const [whole = '', fraction = ''] = uPrice.split('.');
  const digits = whole + fraction;
  const point = whole.length + baseDecimals - quoteDecimals;

  let integer: string;
  let rest: string;
  if (point <= 0) {
    integer = '0';
    rest = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    integer = digits + '0'.repeat(point - digits.length);
    rest = '';
  } else {
    integer = digits.slice(0, point);
    rest = digits.slice(point);
  }
  integer = integer.replace(/^0+(?=\d)/, '');
  rest = rest.replace(/0+$/, '');
  return rest === '' ? integer : `${integer}.${rest}`;
}
