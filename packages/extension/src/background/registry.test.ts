import { describe, expect, it } from 'vitest';
import { fail, ok } from '../protocol';
import { HandlerRegistry } from './registry';

describe('HandlerRegistry', () => {
  it('routes a request to its handler', async () => {
    const registry = new HandlerRegistry();
    registry.register('app.ping', {
      validate: (p) => ok(p as { nonce: string }),
      handle: (req) => Promise.resolve(ok({ nonce: req.nonce, at: 7 })),
    });
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
    registry.register('app.ping', {
      validate: (p) => ok(p as { nonce: string }),
      handle: () => Promise.reject(new Error('mnemonic abandon abandon')),
    });
    const res = await registry.dispatch({ method: 'app.ping', payload: { nonce: 'n' } });
    expect(res).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(JSON.stringify(res)).not.toContain('mnemonic');
  });

  it('runs validate before handle and never calls handle on bad input', async () => {
    const registry = new HandlerRegistry();
    let handled = false;
    registry.register('app.ping', {
      validate: (p) =>
        typeof p === 'string' ? ok({ nonce: p }) : fail('bad_request', 'need a string'),
      handle: (req) => {
        handled = true;
        return Promise.resolve(ok({ nonce: req.nonce, at: 1 }));
      },
    });
    expect(await registry.dispatch({ method: 'app.ping', payload: 5 })).toEqual({
      ok: false,
      error: { code: 'bad_request', message: 'need a string' },
    });
    expect(handled).toBe(false);
    expect(await registry.dispatch({ method: 'app.ping', payload: 'x' })).toMatchObject({
      ok: true,
    });
  });

  it('only accepts known method names at compile time', () => {
    const registry = new HandlerRegistry();
    const handler = {
      validate: (p: unknown) => ok(p),
      handle: () => Promise.resolve(ok(null)),
    };
    expect(() => {
      // @ts-expect-error `app.pnig` is not a method of any feature protocol
      registry.register('app.pnig', handler);
    }).not.toThrow();
  });

  it('refuses to register a method twice', () => {
    const registry = new HandlerRegistry();
    const handler = {
      validate: (p: unknown) => ok(p as { nonce: string }),
      handle: () => Promise.resolve(ok({ nonce: '', at: 0 })),
    };
    registry.register('app.ping', handler);
    expect(() => {
      registry.register('app.ping', handler);
    }).toThrow(/already registered/);
  });
});
