import { describe, expect, it } from 'vitest';
import { ok } from '../protocol';
import { HandlerRegistry } from './registry';

describe('HandlerRegistry', () => {
  it('routes a request to its handler', async () => {
    const registry = new HandlerRegistry();
    registry.register('app.ping', (req) => Promise.resolve(ok({ nonce: req.nonce, at: 7 })));
    expect(await registry.dispatch({ method: 'app.ping', payload: { nonce: 'n' } })).toEqual({
      ok: true,
      value: { nonce: 'n', at: 7 },
    });
  });

  it('answers an unknown method with an error value', async () => {
    const res = await new HandlerRegistry().dispatch({ method: 'nope', payload: {} });
    expect(res).toEqual({
      ok: false,
      error: { code: 'unknown_method', message: expect.any(String) as string },
    });
  });

  it.each([null, 'x', 42, {}, { method: 3 }])('rejects malformed message %j', async (msg) => {
    const res = await new HandlerRegistry().dispatch(msg);
    expect(res).toMatchObject({ ok: false, error: { code: 'bad_request' } });
  });

  it('turns a throwing handler into an internal error without leaking its message', async () => {
    const registry = new HandlerRegistry();
    registry.register('app.ping', () => Promise.reject(new Error('mnemonic abandon abandon')));
    const res = await registry.dispatch({ method: 'app.ping', payload: { nonce: 'n' } });
    expect(res).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(res)).not.toContain('mnemonic');
  });

  it('refuses to register a method twice', () => {
    const registry = new HandlerRegistry();
    const handler = () => Promise.resolve(ok({ nonce: '', at: 0 }));
    registry.register('app.ping', handler);
    expect(() => {
      registry.register('app.ping', handler);
    }).toThrow(/already registered/);
  });
});
