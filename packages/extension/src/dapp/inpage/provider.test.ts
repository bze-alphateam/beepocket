import { describe, expect, it, vi } from 'vitest';
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
  type PageWindow,
} from './provider';

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
  const posted: { channel: string; id: string; method: string; params: unknown }[] = [];
  const origin = 'https://dex.getbze.com';
  const win = Object.assign(new EventTarget(), {
    location: { origin },
    postMessage: vi.fn((message: unknown) => {
      posted.push(message as (typeof posted)[number]);
    }),
  });
  const provider = createProvider({
    win: win as unknown as PageWindow,
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

  it('rejects signDirect and sendTx until they are supported', async () => {
    const t = rig();
    await expect(t.provider.signDirect('beezee-1', 'bze1', {})).rejects.toMatchObject({
      code: 'invalid-request',
      message: 'Not supported yet',
    });
    await expect(t.provider.sendTx('beezee-1', new Uint8Array(), 'sync')).rejects.toMatchObject({
      code: 'invalid-request',
    });
    expect(t.posted).toHaveLength(0);
  });
});

describe('window.beepocket', () => {
  it('is defined once, frozen, not writable and not configurable, and announced', () => {
    const initialized = vi.fn();
    window.addEventListener(INITIALIZED_EVENT, initialized);
    expect(
      installProvider({
        win: window,
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
    expect(installProvider({ win: window, randomBytes: () => undefined })).toBe(false);
    window.removeEventListener(INITIALIZED_EVENT, initialized);
  });
});
