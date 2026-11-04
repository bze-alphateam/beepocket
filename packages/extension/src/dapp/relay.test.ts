import { describe, expect, it, vi } from 'vitest';
import { startRelay } from './relay';
import { PAGE_CHANNEL, WALLET_CHANNEL } from './wire';

/** `orphaned`: a script left behind by an extension reload or update (no runtime id). */
function rig(ack: () => Promise<unknown>, opts: { orphaned?: boolean } = {}) {
  const messages: ((event: { source: unknown; data: unknown }) => void)[] = [];
  const posted: { message: unknown; origin: string }[] = [];
  const win = {
    location: { origin: 'https://dex.getbze.com' },
    postMessage: (message: unknown, origin: string) => {
      posted.push({ message, origin });
    },
    addEventListener: (
      _type: 'message',
      l: (event: { source: unknown; data: unknown }) => void,
    ) => {
      messages.push(l);
    },
  };
  let fromWorker: ((message: unknown, sender: { id?: string }) => void) | undefined;
  const sendMessage = vi.fn(ack);
  startRelay(win, {
    id: opts.orphaned === true ? undefined : 'me',
    sendMessage,
    onMessage: {
      addListener: (l) => {
        fromWorker = l;
      },
    },
  });
  return {
    win,
    posted,
    sendMessage,
    page: (data: unknown, source: unknown = win) => {
      for (const l of messages) l({ source, data });
    },
    worker: (message: unknown, id = 'me') => {
      fromWorker?.(message, { id });
    },
  };
}

const request = { channel: PAGE_CHANNEL, id: 'a', method: 'connect', params: { chainId: 'x' } };

describe('the relay', () => {
  it('forwards a tagged page message and nothing else', () => {
    const t = rig(() => Promise.resolve({ accepted: true }));
    t.page({ ...request, extra: 1 });
    expect(t.sendMessage).toHaveBeenCalledWith({
      dapp: { id: 'a', method: 'connect', params: { chainId: 'x' } },
    });
    t.page(request, {});
    t.page({ ...request, channel: 'other' });
    t.page('text');
    t.page(null);
    expect(t.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('posts a refusal from the worker, an unreachable worker and worker answers to the page', async () => {
    const refused = rig(() =>
      Promise.resolve({ error: { code: 'invalid-request', message: 'no' } }),
    );
    refused.page(request);
    await vi.waitFor(() => {
      expect(refused.posted).toHaveLength(1);
    });
    expect(refused.posted[0]).toEqual({
      message: {
        id: 'a',
        error: { code: 'invalid-request', message: 'no' },
        channel: WALLET_CHANNEL,
      },
      origin: 'https://dex.getbze.com',
    });

    const ok = rig(() => Promise.resolve({ accepted: true }));
    ok.page(request);
    await vi.waitFor(() => {
      expect(ok.posted).toHaveLength(1);
    });
    ok.worker({ dapp: { id: 'a', result: { x: 1 }, channel: 'spoofed' } });
    ok.worker({ dapp: { event: 'accountChanged' } });
    ok.worker({ dapp: { id: 'b', result: 1 } }, 'someone-else');
    ok.worker({ nothing: true });
    expect(ok.posted.map((p) => p.message)).toEqual([
      { id: 'a', ack: true, channel: WALLET_CHANNEL },
      { id: 'a', result: { x: 1 }, channel: WALLET_CHANNEL },
      { event: 'accountChanged', channel: WALLET_CHANNEL },
    ]);
  });

  it('tells the page when the worker took a request, so its liveness timer stops', async () => {
    const t = rig(() => Promise.resolve({ accepted: true }));
    t.page(request);
    await vi.waitFor(() => {
      expect(t.posted).toHaveLength(1);
    });
    expect(t.posted[0]).toEqual({
      message: { id: 'a', ack: true, channel: WALLET_CHANNEL },
      origin: 'https://dex.getbze.com',
    });
  });

  it('answers unavailable when the worker cannot be reached', async () => {
    const down = rig(() => Promise.reject(new Error('Could not establish connection.')));
    down.page(request);
    await vi.waitFor(() => {
      expect(down.posted).toHaveLength(1);
    });
    expect(down.posted[0]?.message).toEqual({
      id: 'a',
      error: { code: 'unavailable', message: 'BeePocket is not responding. Reload this page.' },
      channel: WALLET_CHANNEL,
    });
  });

  it('answers unavailable at once when the extension was updated under the page', () => {
    // An orphaned content script has lost its runtime id: nothing is sent at all.
    const orphan = rig(() => Promise.resolve({ accepted: true }), { orphaned: true });
    orphan.page(request);
    expect(orphan.sendMessage).not.toHaveBeenCalled();
    expect(orphan.posted.map((p) => p.message)).toEqual([
      {
        id: 'a',
        error: { code: 'unavailable', message: 'BeePocket was updated. Reload this page.' },
        channel: WALLET_CHANNEL,
      },
    ]);
  });

  it('answers a generic unavailable when sending throws for another reason', () => {
    const thrown = rig(() => {
      throw new Error('Could not clone the message.');
    });
    thrown.page(request);
    expect(thrown.posted.map((p) => p.message)).toEqual([
      {
        id: 'a',
        error: { code: 'unavailable', message: 'BeePocket is not available.' },
        channel: WALLET_CHANNEL,
      },
    ]);
  });

  it('passes the page send time on with the request', () => {
    const t = rig(() => Promise.resolve({ accepted: true }));
    t.page({ ...request, sentAt: 1234 });
    expect(t.sendMessage).toHaveBeenCalledWith({
      dapp: { id: 'a', method: 'connect', params: { chainId: 'x' }, sentAt: 1234 },
    });
  });

  it('forwards a cancel to the worker and posts nothing back', async () => {
    const t = rig(() => Promise.resolve({ accepted: true }));
    t.page({ channel: PAGE_CHANNEL, id: 'a', cancel: true });
    expect(t.sendMessage).toHaveBeenCalledExactlyOnceWith({ dapp: { id: 'a', cancel: true } });
    await Promise.resolve();
    await Promise.resolve();
    expect(t.posted).toEqual([]);

    // A worker out of reach, or a script orphaned by an update, drops a cancel quietly.
    const down = rig(() => Promise.reject(new Error('gone')));
    down.page({ channel: PAGE_CHANNEL, id: 'a', cancel: true });
    const thrown = rig(() => {
      throw new Error('Extension context invalidated.');
    });
    thrown.page({ channel: PAGE_CHANNEL, id: 'a', cancel: true });
    const orphan = rig(() => Promise.resolve({ accepted: true }), { orphaned: true });
    orphan.page({ channel: PAGE_CHANNEL, id: 'a', cancel: true });
    expect(orphan.sendMessage).not.toHaveBeenCalled();
    await Promise.resolve();
    expect([...down.posted, ...thrown.posted, ...orphan.posted]).toEqual([]);
  });
});
