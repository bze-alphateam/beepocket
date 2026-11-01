import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wordsFor } from './words';

const row = (kind: string, over: Partial<Parameters<typeof wordsFor>[0]> = {}) => ({
  kind,
  category: 'other',
  isSigner: true,
  success: true,
  ...over,
});

/** Copied from Scan's classify tables (see the fixture's `source`): a new kind there fails below. */
const KINDS = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../test/fixtures/scan-kinds.json'), 'utf8'),
  ) as { kinds: string[] }
).kinds;

describe('wordsFor', () => {
  it('has words for every documented kind, none of them the fallback', () => {
    expect(KINDS.length).toBeGreaterThan(60);
    for (const kind of KINDS) {
      expect(wordsFor(row(kind)), kind).not.toBe('Transaction');
      expect(wordsFor(row(kind)), kind).not.toBe('');
    }
  });

  it('reads a send from its category', () => {
    expect(wordsFor(row('send', { category: 'sent' }))).toBe('Sent');
    expect(wordsFor(row('send', { category: 'received', isSigner: false }))).toBe('Received');
  });

  it('reads the two sides of an NFT send, a vesting account, an article and respect', () => {
    expect(wordsFor(row('nft_send'))).toBe('Sent an NFT');
    expect(wordsFor(row('nft_send', { isSigner: false }))).toBe('Received an NFT');
    expect(wordsFor(row('vesting_create'))).toBe('Created a vesting account');
    expect(wordsFor(row('vesting_create', { isSigner: false }))).toBe('Received a vesting account');
    expect(wordsFor(row('article'))).toBe('Added an article');
    expect(wordsFor(row('article', { isSigner: false }))).not.toBe('Added an article');
    expect(wordsFor(row('respect'))).toBe('Paid respect');
    expect(wordsFor(row('respect', { isSigner: false }))).toBe('Received respect');
  });

  it('says what a swap and an order are', () => {
    expect(wordsFor(row('dex_swap'))).toBe('Swapped');
    expect(wordsFor(row('dex_order'))).toBe('Placed an order');
  });

  it('falls back to "Transaction" for an unknown kind, "other" and inherited names', () => {
    expect(wordsFor(row('brand_new_kind'))).toBe('Transaction');
    expect(wordsFor(row('other'))).toBe('Transaction');
    expect(wordsFor(row('constructor'))).toBe('Transaction');
  });

  it('prefixes a failed row', () => {
    expect(wordsFor(row('dex_swap', { success: false }))).toBe('Failed: Swapped');
    expect(wordsFor(row('mystery', { success: false }))).toBe('Failed: Transaction');
  });
});
