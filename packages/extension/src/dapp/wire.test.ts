import { describe, expect, it } from 'vitest';
import { bigintFromWire, bigintToWire, bytesFromWire, bytesToWire } from './wire';

describe('wire encoding', () => {
  it('round-trips bytes through base64, including all byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesFromWire(bytesToWire(all))).toEqual(all);
    expect(bytesFromWire(bytesToWire(new Uint8Array()))).toEqual(new Uint8Array());
  });

  it('round-trips bigints through decimal strings, beyond 2^64', () => {
    for (const n of [0n, 1n, 2n ** 64n, 2n ** 256n - 1n, 123456789012345678901234567890n]) {
      expect(bigintFromWire(bigintToWire(n))).toBe(n);
    }
  });

  it('refuses text that is not base64 or not a plain decimal', () => {
    for (const bad of ['a', 'a===', '%%%%', 'AAA']) {
      expect(() => bytesFromWire(bad)).toThrow();
    }
    for (const bad of ['', '-1', '1.5', '0x10', '01', ' 1']) {
      expect(() => bigintFromWire(bad)).toThrow();
    }
  });

  it('refuses a huge digit string without parsing it, but still parses uint256 max', () => {
    const started = performance.now();
    expect(() => bigintFromWire('9'.repeat(1_000_000))).toThrow();
    expect(() => bigintFromWire('1'.repeat(79))).toThrow();
    expect(performance.now() - started).toBeLessThan(500);
    expect(bigintFromWire((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
  });
});
