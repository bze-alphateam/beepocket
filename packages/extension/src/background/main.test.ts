import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { startBackground, type BackgroundEnv } from './main';
import { FakeArea } from '../platform/test-support';

type Listener = Parameters<BackgroundEnv['chrome']['runtime']['onMessage']['addListener']>[0];

function start() {
  const local = new FakeArea();
  const session = new FakeArea();
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
  const send = (message: unknown, senderId: string | undefined = 'me') =>
    new Promise<{ async: boolean | undefined; reply: unknown }>((resolve) => {
      let reply: unknown;
      const async = listener?.(message, { id: senderId }, (r) => {
        reply = r;
        resolve({ async, reply });
      });
      if (async !== true) resolve({ async, reply });
    });
  return { send, local, session };
}

describe('startBackground', () => {
  it('answers app.ping from the extension itself', async () => {
    const { send, session } = start();
    const { async, reply } = await send({ method: 'app.ping', payload: { nonce: 'abc' } });
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

  it('ignores messages from other senders', async () => {
    const { send } = start();
    const { async, reply } = await send({ method: 'app.ping', payload: { nonce: 'x' } }, 'other');
    expect(async).toBeUndefined();
    expect(reply).toBeUndefined();
  });
});
