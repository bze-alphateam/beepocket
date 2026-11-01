import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
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

function start(session: FakeArea = new FakeArea()) {
  const local = new FakeArea();
  let listener: Listener | undefined;
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
  return { send, local, session };
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
    ['a tab (content script)', { ...OWN, tab: { id: 1 } }],
  ])('ignores messages from %s', async (_name, sender) => {
    const { send } = start();
    const { async, reply } = await send(ping, sender);
    expect(async).toBeUndefined();
    expect(reply).toBeUndefined();
  });

  it('retries a failed start on the next message', async () => {
    const { send } = start(new FlakySession(1));
    const first = await send(ping);
    expect(first.reply).toMatchObject({ ok: false, error: { code: 'internal' } });
    const second = await send(ping);
    expect(second.reply).toMatchObject({ ok: true, value: { nonce: 'abc' } });
  });
});
