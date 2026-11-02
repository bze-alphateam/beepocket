import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FakeArea } from '../platform/test-support';
import { startBackground, type BackgroundEnv, type MessageSender } from './main';

type Listener = Parameters<BackgroundEnv['chrome']['runtime']['onMessage']['addListener']>[0];

const OWN: MessageSender = { id: 'me', url: 'chrome-extension://me/popup.html' };

/** Fails `setAccessLevel` the first `failures` times, like a worker that starts badly. */
class FlakySession extends FakeArea {
  constructor(private failures: number) {
    super();
  }

  override setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void> {
    if (this.failures-- > 0) return Promise.reject(new Error('storage not ready'));
    return super.setAccessLevel(options);
  }
}

/** Rejects the first `remove`: the service's own lock fails, the direct clear must still work. */
class FailingRemove extends FakeArea {
  private armed = false;

  arm(): void {
    this.armed = true;
  }

  override remove(keys: string): Promise<void> {
    if (this.armed && keys === 'wallet.key') {
      this.armed = false;
      return Promise.reject(new Error('storage busy'));
    }
    return super.remove(keys);
  }
}

function start(session: FakeArea = new FakeArea()) {
  const local = new FakeArea();
  const tabMessages: { tabId: number; message: unknown; documentId: string | undefined }[] = [];
  let listener: Listener | undefined;
  let onAlarm: ((alarm: { name: string }) => void) | undefined;
  startBackground({
    chrome: {
      storage: { local, session },
      runtime: {
        id: 'me',
        onMessage: {
          addListener: (l) => {
            listener = l;
          },
        },
      },
      tabs: {
        sendMessage: (tabId, message, options) => {
          tabMessages.push({ tabId, message, documentId: options?.documentId });
          return Promise.resolve();
        },
        onRemoved: { addListener: () => undefined },
      },
      windows: {
        create: () => Promise.resolve({ id: 1 }),
        get: () => Promise.resolve({}),
        update: () => Promise.resolve({}),
      },
      alarms: {
        create: () => Promise.resolve(),
        clear: () => Promise.resolve(true),
        onAlarm: {
          addListener: (l) => {
            onAlarm = l;
          },
        },
      },
    },
    crypto: webcrypto as unknown as Crypto,
    fetch: () => Promise.reject(new Error('no network')),
  });
  if (!listener) throw new Error('no listener registered');
  const send = (message: unknown, sender: MessageSender = OWN) =>
    new Promise<{ async: boolean | undefined; reply: unknown }>((resolve) => {
      let reply: unknown;
      const async = listener?.(message, sender, (r) => {
        reply = r;
        resolve({ async, reply });
      });
      if (async !== true) resolve({ async, reply });
    });
  const alarm = (name: string) => onAlarm?.({ name });
  return { send, local, session, alarm, tabMessages };
}

const ping = { method: 'app.ping', payload: { nonce: 'abc' } };

describe('startBackground', () => {
  it('answers app.ping from the extension itself', async () => {
    const { send, session } = start();
    const { async, reply } = await send(ping);
    expect(async).toBe(true);
    expect(reply).toMatchObject({
      ok: true,
      value: { nonce: 'abc', at: expect.any(Number) as number },
    });
    expect(session.accessLevels).toEqual(['TRUSTED_CONTEXTS']);
  });

  it('returns an error value for an unknown request', async () => {
    const { send } = start();
    const { reply } = await send({ method: 'wallet.nope', payload: {} });
    expect(reply).toMatchObject({ ok: false, error: { code: 'unknown_method' } });
  });

  it('answers bad_request when the payload fails validation', async () => {
    const { send } = start();
    for (const payload of [undefined, null, {}, { nonce: 5 }]) {
      const { reply } = await send({ method: 'app.ping', payload });
      expect(reply).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    }
  });

  it.each([
    ['another extension', { id: 'other', url: 'chrome-extension://other/popup.html' }],
    ['no id', { url: 'chrome-extension://me/popup.html' }],
    ['no url', { id: 'me' }],
    [
      'a web page claiming the id',
      { id: 'me', url: 'https://evil.example/chrome-extension://me/' },
    ],
    ['a look-alike id', { id: 'me', url: 'chrome-extension://me2/popup.html' }],
    ['a content script in a tab', { id: 'me', url: 'https://example.com/page', tab: { id: 1 } }],
  ])('ignores messages from %s', async (_name, sender) => {
    const { send } = start();
    const { async, reply } = await send(ping, sender);
    expect(async).toBeUndefined();
    expect(reply).toBeUndefined();
  });

  it('answers an own page that lives in a tab or popup window', async () => {
    const { send } = start();
    const { reply } = await send(ping, { ...OWN, tab: { id: 1 } });
    expect(reply).toMatchObject({ ok: true });
  });

  it('retries a failed start on the next message', async () => {
    const { send } = start(new FlakySession(1));
    const first = await send(ping);
    expect(first.reply).toMatchObject({ ok: false, error: { code: 'internal' } });
    const second = await send(ping);
    expect(second.reply).toMatchObject({ ok: true, value: { nonce: 'abc' } });
  });

  it('still drops the session secrets when the auto-lock fails', async () => {
    const failing = new FailingRemove();
    const t = start(failing);
    failing.data.set('wallet.key', 'AAAA');
    failing.data.set('wallet.profile', {});
    expect(t.session.data.size).toBe(2);
    failing.arm();
    t.alarm('full-lock');
    await vi.waitFor(() => {
      expect(t.session.data.size).toBe(0);
    });
  });
});

const PAGE: MessageSender = {
  id: 'me',
  url: 'https://dex.getbze.com/swap',
  origin: 'https://dex.getbze.com',
  frameId: 0,
  documentId: 'doc-1',
  tab: { id: 4 },
};
const ID = 'ab'.repeat(16);
const connect = (extra: object = {}) => ({
  dapp: { id: ID, method: 'getKey', params: { chainId: 'beezee-1' }, ...extra },
});

describe('dapp channel', () => {
  it('acks a well-formed content script at once and answers the exact document later', async () => {
    const { send, tabMessages } = start();
    const { async, reply } = await send(connect(), PAGE);
    expect(async).toBe(true);
    expect(reply).toEqual({ accepted: true });
    await vi.waitFor(() => {
      expect(tabMessages).toHaveLength(1);
    });
    expect(tabMessages[0]).toMatchObject({
      tabId: 4,
      documentId: 'doc-1',
      message: { dapp: { id: ID, error: { code: 'not-connected' } } },
    });
  });

  it.each([
    ['a missing tab', { ...PAGE, tab: undefined }],
    ['a subframe', { ...PAGE, frameId: 1 }],
    ['no frame id', { ...PAGE, frameId: undefined }],
    ['no document id', { ...PAGE, documentId: undefined }],
    ['a file: page', { ...PAGE, url: 'file:///a.html', origin: 'file://' }],
    ['a null origin', { ...PAGE, origin: 'null' }],
    ['a chrome: page', { ...PAGE, url: 'chrome://settings/', origin: 'chrome://settings' }],
    ['a plain http page', { ...PAGE, url: 'http://example.com/', origin: 'http://example.com' }],
    [
      'http on a look-alike of localhost',
      { ...PAGE, url: 'http://localhost.evil.example/', origin: 'http://localhost.evil.example' },
    ],
    ['another extension', { ...PAGE, id: 'other' }],
    ['an origin with a path', { ...PAGE, origin: 'https://dex.getbze.com/swap' }],
  ])('ignores dapp messages from %s', async (_name, sender) => {
    const { send, tabMessages } = start();
    const { async, reply } = await send(connect(), sender);
    expect(async).toBeUndefined();
    expect(reply).toBeUndefined();
    expect(tabMessages).toHaveLength(0);
  });

  it('accepts http://localhost with a port', async () => {
    const { send } = start();
    const { reply } = await send(connect(), {
      ...PAGE,
      url: 'http://localhost:3000/dapp/',
      origin: 'http://localhost:3000',
    });
    expect(reply).toEqual({ accepted: true });
  });

  it('never lets a content script reach the popup registry', async () => {
    const { send } = start();
    expect((await send(ping, PAGE)).reply).toBeUndefined();
    for (const method of ['app.ping', 'wallet.unlock', 'dapp.answer']) {
      const { reply } = await send({ dapp: { id: ID, method, params: {} } }, PAGE);
      expect(reply).toEqual({ error: { code: 'invalid-request', message: 'Unknown method.' } });
    }
  });

  it('never lets an own page reach the dapp registry', async () => {
    const { send, tabMessages } = start();
    const { reply } = await send(connect(), OWN);
    expect(reply).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    expect(tabMessages).toHaveLength(0);
  });
});
