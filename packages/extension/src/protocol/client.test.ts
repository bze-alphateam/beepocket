import { describe, expect, it, vi } from 'vitest';
import { RuntimeClient } from './client';

describe('RuntimeClient', () => {
  it('only accepts known method names at compile time', async () => {
    const client = new RuntimeClient({ sendMessage: () => Promise.resolve(undefined) });
    // @ts-expect-error `no.such.method` is not a method of any feature protocol
    const res = await client.call('no.such.method', {});
    expect(res.ok).toBe(false);
  });

  it('sends the method and payload and returns the result', async () => {
    const sendMessage = vi.fn(() => Promise.resolve({ ok: true, value: { nonce: 'n', at: 1 } }));
    const res = await new RuntimeClient({ sendMessage }).call('app.ping', { nonce: 'n' });
    expect(sendMessage).toHaveBeenCalledWith({ method: 'app.ping', payload: { nonce: 'n' } });
    expect(res).toEqual({ ok: true, value: { nonce: 'n', at: 1 } });
  });

  it('passes worker errors through as values', async () => {
    const error = { code: 'unknown_method', message: 'no' };
    const client = new RuntimeClient({ sendMessage: () => Promise.resolve({ ok: false, error }) });
    expect(await client.call('app.ping', { nonce: 'n' })).toEqual({ ok: false, error });
  });

  it('maps a failed send to a transport error instead of throwing', async () => {
    const client = new RuntimeClient({ sendMessage: () => Promise.reject(new Error('gone')) });
    expect(await client.call('app.ping', { nonce: 'n' })).toMatchObject({
      ok: false,
      error: { code: 'transport' },
    });
  });

  it.each([undefined, 'x', { ok: true }, { ok: false }, { ok: false, error: { code: 1 } }])(
    'maps a malformed reply %j to a transport error',
    async (reply) => {
      const client = new RuntimeClient({ sendMessage: () => Promise.resolve(reply) });
      expect(await client.call('app.ping', { nonce: 'n' })).toMatchObject({
        ok: false,
        error: { code: 'transport' },
      });
    },
  );
});
