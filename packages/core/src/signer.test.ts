import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import { testMnemonic } from '../test/golden';
import { LocalSigner, deriveAccount } from './index';

const provider = () => vi.fn(() => Promise.resolve(testMnemonic));

describe('LocalSigner', () => {
  it('returns the compressed public key of the account', async () => {
    const signer = new LocalSigner(provider());
    expect(await signer.pubKey(1)).toEqual(deriveAccount(testMnemonic, 1).pubKey);
  });

  it('asks the mnemonic provider once per call', async () => {
    const mnemonic = provider();
    const signer = new LocalSigner(mnemonic);
    await signer.pubKey(0);
    expect(mnemonic).toHaveBeenCalledTimes(1);
    await signer.signDirect(0, new Uint8Array([1]));
    expect(mnemonic).toHaveBeenCalledTimes(2);
    await signer.signDirect(0, new Uint8Array([2]));
    expect(mnemonic).toHaveBeenCalledTimes(3);
  });

  it('fails when the mnemonic provider fails', async () => {
    const signer = new LocalSigner(() => Promise.reject(new Error('vault is locked')));
    await expect(signer.signDirect(0, new Uint8Array([1]))).rejects.toThrow('vault is locked');
    await expect(signer.pubKey(0)).rejects.toThrow('vault is locked');
  });

  it('produces 64-byte low-S signatures that verify', async () => {
    const signer = new LocalSigner(provider());
    const pubKey = await signer.pubKey(0);
    const half = secp256k1.Point.Fn.ORDER / 2n;
    for (let i = 0; i < 16; i++) {
      const doc = new Uint8Array([i, i >> 1, 7, 7, 7]);
      const sig = await signer.signDirect(0, doc);
      expect(sig).toHaveLength(64);
      const s = BigInt(`0x${Buffer.from(sig.subarray(32)).toString('hex')}`);
      expect(s <= half).toBe(true);
      expect(secp256k1.verify(sig, sha256(doc), pubKey, { prehash: false })).toBe(true);
    }
  }, 30_000);

  it('is deterministic (RFC 6979)', async () => {
    const signer = new LocalSigner(provider());
    const doc = new Uint8Array([9, 9, 9]);
    expect(await signer.signDirect(0, doc)).toEqual(await signer.signDirect(0, doc));
  });
});
