import { describe, expect, it, vi } from 'vitest';
import { startRelay } from './relay';
import { PAGE_CHANNEL, WALLET_CHANNEL } from './wire';

function rig(ack: () => Promise<unknown>) {
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
    id: 'me',
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

    const down = rig(() => Promise.reject(new Error('gone')));
    down.page(request);
    await vi.waitFor(() => {
      expect(down.posted).toHaveLength(1);
    });
    expect(down.posted[0]?.message).toMatchObject({ id: 'a', error: { code: 'invalid-request' } });

    const ok = rig(() => Promise.resolve({ accepted: true }));
    ok.page(request);
    ok.worker({ dapp: { id: 'a', result: { x: 1 }, channel: 'spoofed' } });
    ok.worker({ dapp: { event: 'accountChanged' } });
    ok.worker({ dapp: { id: 'b', result: 1 } }, 'someone-else');
    ok.worker({ nothing: true });
    await Promise.resolve();
    expect(ok.posted.map((p) => p.message)).toEqual([
      { id: 'a', result: { x: 1 }, channel: WALLET_CHANNEL },
      { event: 'accountChanged', channel: WALLET_CHANNEL },
    ]);
  });
});
