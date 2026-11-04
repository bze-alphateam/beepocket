import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeArea } from '../platform/test-support';
import { startBackground, type BackgroundEnv, type MessageSender } from './main';

type Listener = Parameters<BackgroundEnv['chrome']['runtime']['onMessage']['addListener']>[0];

const PAGE: MessageSender = {
  id: 'me',
  origin: 'https://getbze.com',
  url: 'https://getbze.com/wallet/add/?code=ubze',
  frameId: 0,
  documentId: 'doc1',
  tab: { id: 3 },
};
const OWN: MessageSender = { id: 'me', url: 'chrome-extension://me/popup.html' };
const LINK = { addToken: { code: 'factory/bze1abc/gold', referrer: 'https://dex.getbze.com' } };

function start(tabs: { url: string; lastAccessed: number }[] = []) {
  const created: string[] = [];
  let listener: Listener | undefined;
  let installed: ((details: { reason: string }) => void) | undefined;
  startBackground({
    chrome: {
      storage: { local: new FakeArea(), session: new FakeArea() },
      runtime: {
        id: 'me',
        onInstalled: {
          addListener: (l) => {
            installed = l;
          },
        },
        onMessage: {
          addListener: (l) => {
            listener = l;
          },
        },
      },
      tabs: {
        sendMessage: () => Promise.resolve(),
        onRemoved: { addListener: () => undefined },
        query: () => Promise.resolve(tabs),
        update: () => Promise.resolve({}),
      },
      windows: {
        onRemoved: { addListener: () => undefined },
        create: (info) => {
          created.push(info.url);
          return Promise.resolve({ id: 1 });
        },
        get: () => Promise.resolve({}),
        getLastFocused: () => Promise.resolve({}),
        update: () => Promise.resolve({}),
      },
      alarms: {
        create: () => Promise.resolve(),
        clear: () => Promise.resolve(true),
        onAlarm: { addListener: () => undefined },
      },
    },
    crypto: webcrypto as unknown as Crypto,
    fetch: () => Promise.reject(new Error('no network')),
  });
  const send = (message: unknown, sender: MessageSender) =>
    new Promise<{ async: boolean | undefined; reply: unknown }>((resolve) => {
      let reply: unknown;
      const async = listener?.(message, sender, (r) => {
        reply = r;
        resolve({ async, reply });
      });
      if (async !== true) resolve({ async, reply });
    });
  const install = async (reason: string) => {
    installed?.({ reason });
    await new Promise((r) => setTimeout(r, 20));
  };
  return { send, install, created };
}

describe('the add-a-token link in the worker', () => {
  it('opens the window and acks a link from the add page', async () => {
    const { send, created } = start();
    const { async, reply } = await send(LINK, PAGE);
    expect(async).toBe(true);
    expect(reply).toEqual({ accepted: true });
    expect(created).toEqual(['popup.html?window=add-token']);
  });

  it.each([
    ['another site', { origin: 'https://evil.example', url: 'https://evil.example/wallet/add/' }],
    [
      'a subdomain',
      { origin: 'https://dex.getbze.com', url: 'https://dex.getbze.com/wallet/add/' },
    ],
    ['an iframe', { frameId: 2 }],
    ['another path', { url: 'https://getbze.com/swap/' }],
    ['another extension', { id: 'other' }],
  ])('ignores a link from %s', async (_name, change) => {
    const { send, created } = start();
    const { async, reply } = await send(LINK, { ...PAGE, ...change });
    expect(async).toBeUndefined();
    expect(reply).toBeUndefined();
    expect(created).toEqual([]);
  });

  it('refuses a bad code with an error ack and no window', async () => {
    const { send, created } = start();
    const { reply } = await send({ addToken: { code: 'bad code', referrer: '' } }, PAGE);
    expect(reply).toMatchObject({ error: { code: 'invalid-request' } });
    expect(created).toEqual([]);
  });

  it('lets the extension pages read the waiting link', async () => {
    const { send } = start();
    await send(LINK, PAGE);
    const { reply } = await send({ method: 'addtoken.current', payload: {} }, OWN);
    expect(reply).toEqual({
      ok: true,
      value: {
        status: 'link',
        source: 'link',
        code: 'factory/bze1abc/gold',
        host: 'dex.getbze.com',
        known: true,
      },
    });
  });

  it('keeps the link methods away from content scripts', async () => {
    const { send } = start();
    const { async } = await send({ method: 'addtoken.current', payload: {} }, PAGE);
    expect(async).toBeUndefined();
  });

  it('looks for the add page in open tabs on install only', async () => {
    const tabs = [{ url: 'https://getbze.com/wallet/add/?code=ubze', lastAccessed: 5 }];
    const update = start(tabs);
    await update.install('update');
    expect(update.created).toEqual([]);
    const fresh = start(tabs);
    await fresh.install('install');
    expect(fresh.created).toEqual(['popup.html?window=onboarding']);
  });
});
