import { webcrypto } from 'node:crypto';
import { DecryptError } from '@beepocket/core';
import { describe, expect, it, vi } from 'vitest';
import { createPlatform } from '.';
import { FakeArea } from './test-support';

function env() {
  const local = new FakeArea();
  const session = new FakeArea();
  const fetchFn = vi.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 200 })));
  return {
    local,
    session,
    fetchFn,
    env: {
      chrome: { storage: { local, session } },
      crypto: webcrypto as unknown as Crypto,
      fetch: fetchFn as unknown as typeof fetch,
    },
  };
}

describe('createPlatform', () => {
  it('sets the session access level to TRUSTED_CONTEXTS once', async () => {
    const e = env();
    await createPlatform(e.env);
    expect(e.session.accessLevels).toEqual(['TRUSTED_CONTEXTS']);
    expect(e.local.accessLevels).toEqual([]);
  });

  it('keeps persistent and session data apart', async () => {
    const e = env();
    const p = await createPlatform(e.env);
    await p.storage.set('a', 1);
    await p.session.set('b', 2);
    expect(e.local.data.has('a')).toBe(true);
    expect(e.local.data.has('b')).toBe(false);
    expect(e.session.data.has('b')).toBe(true);
  });

  it('encrypts with AAD and fails when the AAD changes', async () => {
    const p = await createPlatform(env().env);
    const key = p.random.bytes(32);
    const nonce = p.random.bytes(12);
    const aad = new TextEncoder().encode('vault');
    const plain = new TextEncoder().encode('secret');
    const ct = await p.cipher.encrypt(key, nonce, plain, aad);
    const opened = await p.cipher.decrypt(key, nonce, ct, aad);
    expect(new TextDecoder().decode(opened)).toBe('secret');
    await expect(
      p.cipher.decrypt(key, nonce, ct, new TextEncoder().encode('profile')),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it('returns random bytes of the requested length, also past 64 KiB', async () => {
    const p = await createPlatform(env().env);
    expect(p.random.bytes(12)).toHaveLength(12);
    const big = p.random.bytes(70000);
    expect(big).toHaveLength(70000);
    expect(big.subarray(65536).some((b) => b !== 0)).toBe(true);
  });

  it('sends HTTP through fetch', async () => {
    const e = env();
    const p = await createPlatform(e.env);
    const res = await p.transport.request({ method: 'GET', url: 'https://rest.getbze.com/x' });
    expect(res).toEqual({ status: 200, body: '{"ok":true}' });
    expect(e.fetchFn).toHaveBeenCalledOnce();
  });

  it('reads the system clock', async () => {
    const p = await createPlatform(env().env);
    expect(Math.abs(p.clock.now() - Date.now())).toBeLessThan(1000);
  });
});
