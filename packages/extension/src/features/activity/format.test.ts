import { describe, expect, it } from 'vitest';
import type { ActivityAmount } from '../../protocol';
import { amountParts, amountText, whenText } from './format';

const amt = (amount: string, over: Partial<ActivityAmount> = {}): ActivityAmount => ({
  denom: 'ubze',
  amount,
  symbol: 'BZE',
  exponent: 6,
  ...over,
});

describe('amountText', () => {
  it("signs and formats a change with Scan's symbol and exponent", () => {
    expect(amountText(amt('1500000'))).toBe('+1.50 BZE');
    expect(amountText(amt('-20000'))).toBe('−0.02 BZE');
  });

  it("falls back to the wallet's own token data when Scan has none", () => {
    const known = [{ denom: 'uoth', symbol: 'OTH', decimals: 2 }];
    expect(amountText(amt('500', { denom: 'uoth', symbol: null, exponent: null }), known)).toBe(
      '+5.00 OTH',
    );
  });

  it('shows a token nobody knows as raw base units with separators, never invented decimals', () => {
    const unknown = amt('1250000000000000000', {
      denom: 'ibc/6490A7EA3C2D8B1F4E5A9C0D7B3F2E1A6C8D4B5E9F0A1C2D3E4F5A6B7C8D9E0F',
      symbol: null,
      exponent: null,
    });
    expect(amountText(unknown)).toBe('+1,250,000,000,000,000,000 ibc/6490…9E0F');
    expect(amountText(amt('-42', { denom: 'x/y', symbol: null, exponent: null }))).toBe('−42 x/y');
  });
});

describe('amountParts', () => {
  const bare = (denom: string) => amountParts(amt('7', { denom, symbol: null, exponent: null }));

  it('marks a registered token known, with its own symbol never shortened', () => {
    const p = amountParts(amt('1500000', { symbol: 'AVERYLONGSYMBOLNAME' }));
    expect(p).toEqual({
      value: '+1.50',
      symbol: 'AVERYLONGSYMBOLNAME',
      denom: 'ubze',
      unknown: false,
    });
  });

  it('shortens ibc denoms to ibc/ + 4 … 4, and leaves a short hash whole', () => {
    const full = 'ibc/6490A7EA3C2D8B1F4E5A9C0D7B3F2E1A6C8D4B5E9F0A1C2D3E4F5A6B7C8D9E0F';
    expect(bare(full)).toMatchObject({ symbol: 'ibc/6490…9E0F', unknown: true, denom: full });
    expect(bare('ibc/ABCD1234').symbol).toBe('ibc/ABCD1234');
    expect(bare('ibc/AB').symbol).toBe('ibc/AB');
  });

  it('shortens factory denoms: names up to 10 characters stay, longer ones keep 9 and an ellipsis', () => {
    expect(bare('factory/bze1abcdef/abcdefghij').symbol).toBe('factory/…/abcdefghij');
    expect(bare('factory/bze1abcdef/abcdefghijk').symbol).toBe('factory/…/abcdefghi…');
  });

  it('keeps any other denom whole for the stylesheet to ellipsise', () => {
    const long = 'ibcibcibcibcibcibcibc';
    expect(bare(long)).toMatchObject({ symbol: long, unknown: true });
  });

  it("takes the wallet's own symbol as known data", () => {
    const known = [{ denom: 'uoth', symbol: 'OTH', decimals: 2 }];
    const unscanned = amt('500', { denom: 'uoth', symbol: null, exponent: null });
    expect(amountParts(unscanned, known)).toMatchObject({ symbol: 'OTH', unknown: false });
  });
});

describe('whenText', () => {
  const at = new Date(2026, 9, 31, 20, 54).toISOString();

  it('reads 24-hour time, then day and short month', () => {
    expect(whenText(at, 'en-US')).toBe('20:54 · 31 Oct');
    expect(whenText(at, 'en-GB')).toBe('20:54 · 31 Oct');
    expect(whenText(new Date(2026, 10, 2, 8, 5).toISOString(), 'en-US')).toBe('08:05 · 2 Nov');
  });

  it('is empty for a time it cannot read', () => {
    expect(whenText('not a time')).toBe('');
  });
});
