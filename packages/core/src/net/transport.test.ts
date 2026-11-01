import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchTransport, TransportError } from '../index';

type FetchFn = typeof fetch;

/** A fetch that never answers on its own: it settles only when its signal aborts. */
function hangingFetch(calls: { url: string; init: RequestInit }[]): FetchFn {
  return ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason as Error);
      });
    });
  }) as unknown as FetchFn;
}

function answeringFetch(
  calls: { url: string; init: RequestInit }[],
  status: number,
  body: string,
): FetchFn {
  return ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as FetchFn;
}

describe('FetchTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns status and body, and forbids redirects', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const res = await new FetchTransport(answeringFetch(calls, 404, '{"code":5}')).request({
      method: 'GET',
      url: 'https://rest.getbze.com/x',
    });
    expect(res).toEqual({ status: 404, body: '{"code":5}' });
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it('sends a JSON body on POST', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await new FetchTransport(answeringFetch(calls, 200, '{}')).request({
      method: 'POST',
      url: 'https://rest.getbze.com/x',
      body: '{"a":1}',
    });
    expect(calls[0]?.init.body).toBe('{"a":1}');
    expect(calls[0]?.init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('aborts after the timeout (15 s by default)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const pending = new FetchTransport(hangingFetch(calls)).request({
      method: 'GET',
      url: 'https://x.test/',
    });
    const outcome = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[0]?.init.signal?.aborted).toBe(true);
    expect(await outcome).toBeInstanceOf(TransportError);
  });

  it('honours a custom timeout', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const outcome = new FetchTransport(hangingFetch(calls), 100)
      .request({ method: 'GET', url: 'https://x.test/' })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({
      name: 'TransportError',
      message: expect.stringContaining('timed out') as string,
    });
  });

  it('wraps a refused redirect (a fetch rejection) in TransportError', async () => {
    const refusing = (() =>
      Promise.reject(new TypeError('redirect mode is set to error'))) as unknown as FetchFn;
    const err = await new FetchTransport(refusing)
      .request({ method: 'GET', url: 'https://x.test/' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).cause).toBeInstanceOf(TypeError);
  });

  it('passes a caller abort through', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const caller = new AbortController();
    const outcome = new FetchTransport(hangingFetch(calls))
      .request({ method: 'GET', url: 'https://x.test/', signal: caller.signal })
      .catch((e: unknown) => e);
    caller.abort(new Error('stop'));
    expect(await outcome).toEqual(new Error('stop'));
  });

  it('stops its timer once the response is in', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await new FetchTransport(answeringFetch(calls, 200, '{}')).request({
      method: 'GET',
      url: 'https://x.test/',
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
