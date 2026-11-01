import { describe, expect, it } from 'vitest';
import { bech32 } from '@scure/base';
import { deriveAccount, isBzeAddress, shortAddress } from '../index';

const mnemonic = `${'abandon '.repeat(23)}art`;
const golden = [
  {
    address: 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g',
    pubKey: 'ArpmqEz3g5rxcqE+f8n15wCMuLyhWF+PO6+zA57aPB/d',
  },
  {
    address: 'bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p',
    pubKey: 'A8Rwh1GVVSN9+PEXXnqiTh95gQdvksVh2oUG9yQol73Z',
  },
];

describe('deriveAccount', () => {
  it.each([0, 1])('matches the bzed golden values for index %i', (i) => {
    const acc = deriveAccount(mnemonic, i);
    expect(acc.index).toBe(i);
    expect(acc.address).toBe(golden[i]?.address);
    expect(Buffer.from(acc.pubKey).toString('base64')).toBe(golden[i]?.pubKey);
    expect(acc.pubKey).toHaveLength(33);
    expect(acc.privKey).toHaveLength(32);
  });

  it('rejects invalid indexes', () => {
    expect(() => deriveAccount(mnemonic, -1)).toThrow(RangeError);
    expect(() => deriveAccount(mnemonic, 1.5)).toThrow(RangeError);
    expect(() => deriveAccount(mnemonic, 2 ** 31)).toThrow(RangeError);
  });
});

describe('isBzeAddress', () => {
  it('accepts the golden addresses', () => {
    for (const g of golden) expect(isBzeAddress(g.address)).toBe(true);
  });

  it('rejects other prefixes, bad checksums and wrong lengths', () => {
    const data = bech32.toWords(new Uint8Array(20).fill(1));
    expect(isBzeAddress(bech32.encode('cosmos', data))).toBe(false);
    expect(isBzeAddress(bech32.encode('bze', bech32.toWords(new Uint8Array(32).fill(1))))).toBe(
      false,
    );
    const bad = `${golden[0]?.address.slice(0, -1) ?? ''}q`;
    expect(isBzeAddress(bad)).toBe(false);
    expect(isBzeAddress('')).toBe(false);
    expect(isBzeAddress('not an address')).toBe(false);
  });
});

describe('shortAddress', () => {
  it('keeps the first 8 and last 6 characters', () => {
    expect(shortAddress(golden[0]?.address ?? '')).toBe('bze1r5v5…x0ts9g');
  });
});
