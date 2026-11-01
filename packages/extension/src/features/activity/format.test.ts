import { describe, expect, it } from 'vitest';
import type { ActivityAmount } from '../../protocol';
import { amountText } from './format';

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

  it('shows the shortened denom and base units for a token nobody knows', () => {
    const unknown = amt('42', { denom: 'factory/bze1abcdef/zzz', symbol: null, exponent: null });
    expect(amountText(unknown)).toBe('+42 factory/…/zzz');
  });
});

describe('amountText with long denoms', () => {
  const bare = (denom: string) => amountText(amt('7', { denom, symbol: null, exponent: null }));

  it('keeps short denoms and truncates long plain ones', () => {
    expect(bare('ubze')).toBe('+7 ubze');
    expect(bare('ibc'.repeat(10))).toBe('+7 ibcibcibcibcibc…');
  });

  it('shortens factory denoms to their last part', () => {
    expect(bare('factory/bze1abcdef/zzz')).toBe('+7 factory/…/zzz');
  });
});
