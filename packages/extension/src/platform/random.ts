import type { Random } from '@beepocket/core';

/** `Random` over `crypto.getRandomValues`. */
export class CryptoRandom implements Random {
  constructor(private readonly crypto: Pick<Crypto, 'getRandomValues'>) {}

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    // getRandomValues is limited to 65536 bytes per call.
    for (let i = 0; i < n; i += 65536) {
      this.crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, n)));
    }
    return out;
  }
}
