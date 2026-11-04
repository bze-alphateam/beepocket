import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bytesToWire,
  KEYSTORE_EVENT,
  INITIALIZED_EVENT,
  PAGE_CHANNEL,
  WALLET_CHANNEL,
} from '../wire';
import {
  BeePocketError,
  createProvider,
  installProvider,
  type BeePocketProvider,
  type PageTimers,
  type PageWindow,
} from './provider';

/** The page's timers; `vi.useFakeTimers()` drives them in the liveness tests. */
const timers: PageTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const KEY = {
  address: 'bze1abc',
  bech32Address: 'bze1abc',
  pubKey: bytesToWire(Uint8Array.from({ length: 33 }, (_, i) => i)),
  name: 'Main',
  algo: 'secp256k1',
  isNanoLedger: false,
};

/** A window of its own per test (listeners cannot be taken off `window`); records what is posted. */
function rig() {
  const posted: {
    channel: string;
    id: string;
    method?: string;
    params?: unknown;
    sentAt?: number;
    cancel?: true;
  }[] = [];
  const origin = 'https://dex.getbze.com';
  const win = Object.assign(new EventTarget(), {
    location: { origin },
    postMessage: vi.fn((message: unknown) => {
      posted.push(message as (typeof posted)[number]);
    }),
  });
  const provider = createProvider({
    win: win as unknown as PageWindow,
    timers,
    now: () => 1_700_000_000_000,
    randomBytes: (bytes) => {
      crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
    },
  });
  /** A message event as the browser delivers it. */
  const deliver = (data: unknown, source: unknown = win) =>
    win.dispatchEvent(Object.assign(new Event('message'), { data, source }));
  return { provider, posted, deliver, win, origin };
}

describe('the provider', () => {
  it('posts a tagged request with a random 128-bit id and resolves with real types', async () => {
    const t = rig();
    const promise = t.provider.connect('beezee-1');
    const request = t.posted[0];
    expect(request).toMatchObject({
      channel: PAGE_CHANNEL,
      method: 'connect',
      params: { chainId: 'beezee-1' },
    });
    expect(request?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(t.win.postMessage).toHaveBeenCalledWith(expect.anything(), t.origin);

    t.deliver({ channel: WALLET_CHANNEL, id: request?.id, result: KEY });
    const key = await promise;
    expect(key.pubKey).toBeInstanceOf(Uint8Array);
    expect(key.pubKey).toHaveLength(33);
    expect(key).toMatchObject({ address: 'bze1abc', bech32Address: 'bze1abc', name: 'Main' });
  });

  it('rejects with an Error that carries the code', async () => {
    const t = rig();
    const promise = t.provider.getKey('beezee-1');
    t.deliver({
      channel: WALLET_CHANNEL,
      id: t.posted[0]?.id,
      error: { code: 'not-connected', message: 'This site is not connected.' },
    });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BeePocketError);
    expect(error).toMatchObject({ code: 'not-connected', message: 'This site is not connected.' });
  });

  it('ignores answers that did not come from this window or are not tagged', async () => {
    const t = rig();
    let settled = false;
    const promise = t.provider.connect('beezee-1').finally(() => {
      settled = true;
    });
    const id = t.posted[0]?.id;
    t.deliver({ channel: WALLET_CHANNEL, id, result: KEY }, {});
    t.deliver({ channel: WALLET_CHANNEL, id, result: KEY }, null);
    t.deliver({ channel: 'something-else', id, result: KEY });
    t.deliver('beepocket');
    t.deliver(null);
    await Promise.resolve();
    expect(settled).toBe(false);
    t.deliver({ channel: WALLET_CHANNEL, id, result: KEY });
    await promise;
  });

  it('answers each caller by its own id', async () => {
    const t = rig();
    const a = t.provider.getKey('beezee-1');
    const b = t.provider.getKey('beezee-1');
    t.deliver({ channel: WALLET_CHANNEL, id: t.posted[1]?.id, result: { ...KEY, name: 'B' } });
    t.deliver({ channel: WALLET_CHANNEL, id: t.posted[0]?.id, result: { ...KEY, name: 'A' } });
    expect((await a).name).toBe('A');
    expect((await b).name).toBe('B');
  });

  it('calls the on() listeners and dispatches beepocket_keystorechange on accountChanged', () => {
    const t = rig();
    const first = vi.fn();
    const second = vi.fn(() => {
      throw new Error('page bug');
    });
    const removed = vi.fn();
    const onWindow = vi.fn();
    t.win.addEventListener(KEYSTORE_EVENT, onWindow);
    t.provider.on('accountChanged', first);
    t.provider.on('accountChanged', second);
    t.provider.on('accountChanged', removed);
    t.provider.off('accountChanged', removed);

    t.deliver({ channel: WALLET_CHANNEL, event: 'accountChanged' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect(onWindow).toHaveBeenCalledTimes(1);

    // A forged event from another window changes nothing.
    t.deliver({ channel: WALLET_CHANNEL, event: 'accountChanged' }, null);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('sends signDirect with bytes as base64 and the account number as a decimal string', async () => {
    const t = rig();
    const body = Uint8Array.from([1, 2, 3]);
    const authInfo = Uint8Array.from([4, 5]);
    const promise = t.provider.signDirect('beezee-1', 'bze1abc', {
      bodyBytes: body,
      authInfoBytes: authInfo,
      chainId: 'beezee-1',
      accountNumber: 12345678901234567890n,
    });
    const request = t.posted[0];
    expect(request).toMatchObject({
      method: 'signDirect',
      params: {
        chainId: 'beezee-1',
        signer: 'bze1abc',
        signDoc: {
          bodyBytes: bytesToWire(body),
          authInfoBytes: bytesToWire(authInfo),
          chainId: 'beezee-1',
          accountNumber: '12345678901234567890',
        },
      },
    });
    const signature = {
      pub_key: { type: 'tendermint/PubKeySecp256k1', value: 'AAAA' },
      signature: 'c2ln',
    };
    t.deliver({
      channel: WALLET_CHANNEL,
      id: request?.id,
      result: {
        signed: {
          bodyBytes: bytesToWire(body),
          authInfoBytes: bytesToWire(Uint8Array.from([9])),
          chainId: 'beezee-1',
          accountNumber: '7',
        },
        signature,
      },
    });
    const response = await promise;
    expect(response.signed.bodyBytes).toEqual(body);
    expect(response.signed.authInfoBytes).toEqual(Uint8Array.from([9]));
    expect(response.signed.accountNumber).toBe(7n);
    expect(response.signature).toEqual(signature);
  });

  it('sends sendTx as base64 and resolves with the hash bytes', async () => {
    const t = rig();
    const promise = t.provider.sendTx('beezee-1', Uint8Array.from([7, 8, 9]), 'sync');
    const request = t.posted[0];
    expect(request).toMatchObject({
      method: 'sendTx',
      params: {
        chainId: 'beezee-1',
        txBytes: bytesToWire(Uint8Array.from([7, 8, 9])),
        mode: 'sync',
      },
    });
    const hash = Uint8Array.from({ length: 32 }, (_, i) => i);
    t.deliver({ channel: WALLET_CHANNEL, id: request?.id, result: bytesToWire(hash) });
    await expect(promise).resolves.toEqual(hash);
  });

  it('rejects malformed signDirect and sendTx input without posting anything', async () => {
    const t = rig();
    await expect(
      t.provider.signDirect(
        'beezee-1',
        'bze1',
        {} as unknown as Parameters<typeof t.provider.signDirect>[2],
      ),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(
      t.provider.sendTx('beezee-1', 'abc' as unknown as Uint8Array, 'sync'),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(t.posted).toHaveLength(0);
  });
});

describe('liveness: every request ends', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const ack = (t: ReturnType<typeof rig>, n = 0) => {
    t.deliver({ channel: WALLET_CHANNEL, id: t.posted[n]?.id, ack: true });
  };
  const cancels = (t: ReturnType<typeof rig>) => t.posted.filter((m) => m.cancel === true);

  it('stamps each request with the time the page sent it', () => {
    const t = rig();
    void t.provider.getKey('beezee-1');
    expect(t.posted[0]?.sentAt).toBe(1_700_000_000_000);
  });

  it('rejects unavailable when the wallet does not take the request in 10 s, and cancels it', async () => {
    vi.useFakeTimers();
    const t = rig();
    let settled = false;
    const promise = t.provider
      .getKey('beezee-1')
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    vi.advanceTimersByTime(9_999);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(cancels(t)).toEqual([]);
    vi.advanceTimersByTime(1);
    const error = await promise;
    expect(error).toBeInstanceOf(BeePocketError);
    expect(error).toMatchObject({
      code: 'unavailable',
      message: 'BeePocket is not responding. Reload this page.',
    });
    // The wallet is told to drop it, should the request still reach it.
    expect(cancels(t)).toEqual([{ channel: PAGE_CHANNEL, id: t.posted[0]?.id, cancel: true }]);
    expect(t.win.postMessage).toHaveBeenLastCalledWith(expect.anything(), t.origin);
    // A late answer changes nothing.
    t.deliver({ channel: WALLET_CHANNEL, id: t.posted[0]?.id, result: KEY });
  });

  it('keeps an acked request waiting for its answer, as long as the user takes', async () => {
    vi.useFakeTimers();
    const t = rig();
    let settled = false;
    const promise = t.provider.connect('beezee-1').finally(() => {
      settled = true;
    });
    vi.advanceTimersByTime(9_999);
    ack(t);
    // Up to the wallet's 10-minute expiry and the minute after it.
    vi.advanceTimersByTime(11 * 60_000 - 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    t.deliver({ channel: WALLET_CHANNEL, id: t.posted[0]?.id, result: KEY });
    await expect(promise).resolves.toMatchObject({ address: 'bze1abc' });
    expect(cancels(t)).toEqual([]);
  });

  it('rejects unavailable when an acked answer is lost, 11 minutes after the ack', async () => {
    vi.useFakeTimers();
    const t = rig();
    const promise = t.provider.getKey('beezee-1').catch((e: unknown) => e);
    ack(t);
    vi.advanceTimersByTime(11 * 60_000);
    expect(await promise).toMatchObject({ code: 'unavailable' });
  });

  it('ignores an ack for a request it is not waiting for', async () => {
    vi.useFakeTimers();
    const t = rig();
    const promise = t.provider.getKey('beezee-1').catch((e: unknown) => e);
    t.deliver({ channel: WALLET_CHANNEL, id: 'f'.repeat(32), ack: true });
    vi.advanceTimersByTime(10_000);
    expect(await promise).toMatchObject({ code: 'unavailable' });
  });

  it('ends and cancels what was waiting when the page comes back from the back/forward cache', async () => {
    const t = rig();
    let settled = 0;
    const a = t.provider.getKey('beezee-1').catch((e: unknown) => e);
    const b = t.provider.connect('beezee-1').catch((e: unknown) => e);
    void Promise.all([a, b].map((p) => p.finally(() => settled++)));
    ack(t, 1);
    // A normal page show is not a restore: nothing ends.
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(0);
    expect(cancels(t)).toEqual([]);
    t.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(await a).toMatchObject({ code: 'unavailable' });
    expect(await b).toMatchObject({ code: 'unavailable' });
    expect(cancels(t).map((m) => m.id)).toEqual([t.posted[0]?.id, t.posted[1]?.id]);
    // A request made after the restore is unaffected.
    const c = t.provider.getKey('beezee-1');
    const last = t.posted[t.posted.length - 1];
    t.deliver({ channel: WALLET_CHANNEL, id: last?.id, result: KEY });
    await expect(c).resolves.toMatchObject({ name: 'Main' });
  });
});

describe('window.beepocket', () => {
  it('is defined once, frozen, not writable and not configurable, and announced', () => {
    const initialized = vi.fn();
    window.addEventListener(INITIALIZED_EVENT, initialized);
    expect(
      installProvider({
        win: window,
        timers,
        now: () => 0,
        randomBytes: (bytes) => {
          crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
        },
      }),
    ).toBe(true);
    expect(initialized).toHaveBeenCalledTimes(1);

    const provider = (window as unknown as { beepocket: BeePocketProvider }).beepocket;
    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(window, 'beepocket')).toMatchObject({
      writable: false,
      configurable: false,
    });
    expect(() => {
      'use strict';
      (window as unknown as { beepocket: unknown }).beepocket = {};
    }).toThrow();
    expect(() => Object.defineProperty(window, 'beepocket', { value: {} })).toThrow();
    expect(() => {
      'use strict';
      (provider as unknown as { connect: unknown }).connect = () => 0;
    }).toThrow();
    expect((window as unknown as { beepocket: unknown }).beepocket).toBe(provider);

    // A second install cannot replace it and says so.
    expect(
      installProvider({ win: window, timers, now: () => 0, randomBytes: () => undefined }),
    ).toBe(false);
    window.removeEventListener(INITIALIZED_EVENT, initialized);
  });
});
