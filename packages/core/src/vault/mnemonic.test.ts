import { describe, expect, it } from 'vitest';
import { createMnemonic, validateMnemonic, type Random } from '../index';

const fixed = (byte: number): Random => ({ bytes: (n) => new Uint8Array(n).fill(byte) });

// Official BIP-39 English test vectors (256-bit entropy).
const vectors: [number, string][] = [
  [0x00, `${'abandon '.repeat(23)}art`],
  [
    0x7f,
    'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title',
  ],
  [
    0x80,
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless',
  ],
  [0xff, `${'zoo '.repeat(23)}vote`],
];

describe('createMnemonic', () => {
  it.each(vectors)('maps entropy 0x%i to the official 24 words', (byte, words) => {
    expect(createMnemonic(fixed(byte))).toBe(words);
  });

  it('rejects a random source that returns the wrong length', () => {
    expect(() => createMnemonic({ bytes: () => new Uint8Array(16) })).toThrow();
  });
});

describe('validateMnemonic', () => {
  const twelve = `${'abandon '.repeat(11)}about`;
  const twentyFour = `${'abandon '.repeat(23)}art`;

  it('accepts 12 and 24 words', () => {
    expect(validateMnemonic(twelve)).toEqual({ ok: true, normalized: twelve });
    expect(validateMnemonic(twentyFour)).toEqual({ ok: true, normalized: twentyFour });
  });

  it('rejects other word counts', () => {
    expect(validateMnemonic(`${'abandon '.repeat(14)}about`)).toEqual({
      ok: false,
      reason: 'word-count',
    });
    expect(validateMnemonic('')).toEqual({ ok: false, reason: 'word-count' });
  });

  it('rejects unknown words', () => {
    expect(validateMnemonic(`${'abandon '.repeat(11)}abandun`)).toEqual({
      ok: false,
      reason: 'unknown-word',
    });
  });

  it('rejects a bad checksum', () => {
    expect(validateMnemonic(`${'abandon '.repeat(11)}abandon`)).toEqual({
      ok: false,
      reason: 'checksum',
    });
  });

  it('normalizes spaces and case', () => {
    const messy = `  ${'ABANDON  \n'.repeat(11)}\tAbout `;
    expect(validateMnemonic(messy)).toEqual({ ok: true, normalized: twelve });
  });
});
