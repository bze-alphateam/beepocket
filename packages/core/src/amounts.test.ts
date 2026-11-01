import { describe, expect, it } from 'vitest';
import { displayPrice, formatAmount, parseAmount } from './index';

describe('formatAmount', () => {
  it.each<[bigint, number, string]>([
    [0n, 6, '0.00'],
    [1_000_000_000n, 6, '1,000.00'],
    [1_500_000n, 6, '1.50'],
    [1_234_567n, 6, '1.234567'],
    [1n, 6, '0.000001'],
    [123n, 0, '123'],
    [1_234_567n, 0, '1,234,567'],
    [5n, 1, '0.5'],
    [50n, 1, '5.0'],
    [1_000_000_000_000_000_000n, 18, '1.00'],
    [1n, 18, '0.00'],
    [123_456_789_012_345_678_901_234_567_890n, 18, '123,456,789,012.345678'],
    [2n ** 64n * 1_000_000n, 6, '18,446,744,073,709,551,616.00'],
    [-1_500_000n, 6, '-1.50'],
  ])('formats %s with %s decimals as %s', (base, decimals, expected) => {
    expect(formatAmount(base, decimals)).toBe(expected);
  });

  it('honours maxFraction and cuts instead of rounding up', () => {
    expect(formatAmount(1_239_999n, 6, { maxFraction: 2 })).toBe('1.23');
    expect(formatAmount(1_239_999n, 6, { maxFraction: 4 })).toBe('1.2399');
    expect(formatAmount(1_239_999n, 6, { maxFraction: 0 })).toBe('1');
    expect(formatAmount(1_000_000n, 6, { maxFraction: 1 })).toBe('1.0');
  });

  it('rejects impossible decimals and maxFraction', () => {
    expect(() => formatAmount(1n, -1)).toThrow(RangeError);
    expect(() => formatAmount(1n, 19)).toThrow(RangeError);
    expect(() => formatAmount(1n, 1.5)).toThrow(RangeError);
    expect(() => formatAmount(1n, 6, { maxFraction: -1 })).toThrow(RangeError);
  });
});

describe('parseAmount', () => {
  it.each<[string, number, bigint]>([
    ['0', 6, 0n],
    ['12', 6, 12_000_000n],
    ['0.5', 6, 500_000n],
    ['1000.25', 6, 1_000_250_000n],
    ['0.000001', 6, 1n],
    ['7', 0, 7n],
    ['1.000000000000000001', 18, 1_000_000_000_000_000_001n],
    ['18446744073709551616', 6, 18_446_744_073_709_551_616_000_000n],
    ['007.50', 2, 750n],
  ])('parses %s with %s decimals', (text, decimals, expected) => {
    expect(parseAmount(text, decimals)).toBe(expected);
  });

  it.each<[string, number]>([
    ['', 6],
    ['-1', 6],
    ['-0', 6],
    ['1e3', 6],
    ['1E3', 6],
    ['1.0000001', 6],
    ['1.5', 0],
    ['.5', 6],
    ['1.', 6],
    ['1,000', 6],
    [' 1', 6],
    ['+1', 6],
    ['abc', 6],
    ['1.2.3', 6],
    ['9'.repeat(101), 6],
  ])('rejects %j with %s decimals', (text, decimals) => {
    expect(parseAmount(text, decimals)).toBeInstanceOf(Error);
  });

  it('round-trips with formatAmount at full precision', () => {
    const base = 123_456_789_012_345_678n;
    const text = formatAmount(base, 18, { maxFraction: 18 }).replaceAll(',', '');
    expect(parseAmount(text, 18)).toBe(base);
  });
});

describe('displayPrice', () => {
  it.each<[string, number, number, string]>([
    // the dapps' own cases: uPriceToPrice(priceToUPrice(0.025, 6, 8), 6, 8) and ('300', 8, 6)
    ['2.5', 6, 8, '0.025'],
    ['0.00025', 8, 6, '0.025'],
    ['300', 8, 6, '30000'],
    ['300', 6, 8, '3'],
    ['1', 6, 6, '1'],
    ['0.5', 6, 6, '0.5'],
    ['1.50', 6, 6, '1.5'],
    ['0.00000005', 6, 6, '0.00000005'],
    ['1234.5', 6, 8, '12.345'],
    ['0.000000000000000001', 6, 6, '0.000000000000000001'],
    ['0', 6, 8, '0'],
    ['0.001', 6, 0, '1000'],
    ['1', 0, 18, '0.000000000000000001'],
    ['123456789012345678901234567890', 18, 0, '123456789012345678901234567890000000000000000000'],
  ])('uPrice %s base %s quote %s -> %s', (uPrice, base, quote, expected) => {
    expect(displayPrice(uPrice, base, quote)).toBe(expected);
  });

  it('rejects anything but a plain non-negative decimal', () => {
    for (const bad of ['', '-1', '1e3', '.5', '1.', 'x', '1'.repeat(101)])
      expect(() => displayPrice(bad, 6, 6)).toThrow(RangeError);
    expect(() => displayPrice('1', 19, 6)).toThrow(RangeError);
  });
});
