import { describe, expect, it } from 'vitest';
import type { SessionStorage } from '../../platform';
import { PENDING_WINDOW_MS, SessionPendingSends, type PendingSend } from './pending';

function memorySession(): SessionStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (k) => Promise.resolve(data.get(k)),
    set: (k, v) => {
      data.set(k, v);
      return Promise.resolve();
    },
    setMany: (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      data.delete(k);
      return Promise.resolve();
    },
  };
}

const NOW = 1_000_000;
const HEIGHT = 1_000n;

const send = (letter: string, over: Partial<PendingSend> = {}): PendingSend => ({
  txHash: letter.repeat(64),
  sequence: '5',
  timeoutHeight: '1030',
  signedAt: NOW,
  ...over,
});

describe('SessionPendingSends', () => {
  it('lets one claim through per address until it is released', async () => {
    const pending = new SessionPendingSends(memorySession(), 'mainnet');
    const [first, second] = await Promise.all([
      pending.claim('bze1a', NOW),
      pending.claim('bze1a', NOW),
    ]);
    expect([first, second]).toEqual([[], null]);
    expect(await pending.claim('bze1b', NOW)).toEqual([]);
    await pending.release('bze1a');
    expect(await pending.claim('bze1a', NOW)).toEqual([]);
  });

  it('shares claims between stores over the same session, not across networks', async () => {
    const session = memorySession();
    expect(await new SessionPendingSends(session, 'mainnet').claim('bze1a', NOW)).toEqual([]);
    expect(await new SessionPendingSends(session, 'mainnet').claim('bze1a', NOW)).toBeNull();
    expect(await new SessionPendingSends(session, 'testnet').claim('bze1a', NOW)).toEqual([]);
  });

  it('refuses a claim within the window after a recorded send, and returns it after', async () => {
    const pending = new SessionPendingSends(memorySession(), 'mainnet');
    await pending.record('bze1a', send('A'), HEIGHT);
    expect(await pending.claim('bze1a', NOW + PENDING_WINDOW_MS - 1)).toBeNull();
    expect(await pending.claim('bze1a', NOW + PENDING_WINDOW_MS)).toEqual([send('A')]);
  });

  it('keeps every unsettled send of an address and settles them one by one', async () => {
    const pending = new SessionPendingSends(memorySession(), 'mainnet');
    await pending.record('bze1a', send('A'), HEIGHT);
    await pending.record('bze1a', send('B'), HEIGHT);
    const later = NOW + PENDING_WINDOW_MS;
    expect(await pending.claim('bze1a', later)).toEqual([send('A'), send('B')]);
    await pending.release('bze1a');

    await pending.settle('b'.repeat(64));
    expect(await pending.claim('bze1a', later)).toEqual([send('A')]);
    await pending.release('bze1a');
    await pending.settle('A'.repeat(64));
    expect(await pending.claim('bze1a', later)).toEqual([]);
  });

  it('drops sends that can no longer be included', async () => {
    const pending = new SessionPendingSends(memorySession(), 'mainnet');
    await pending.record('bze1a', send('A', { timeoutHeight: '999' }), HEIGHT);
    await pending.record('bze1a', send('B'), HEIGHT);
    expect(await pending.claim('bze1a', NOW + PENDING_WINDOW_MS)).toEqual([send('B')]);
  });

  it('loses no send when addresses record at the same time', async () => {
    const session = memorySession();
    const pending = new SessionPendingSends(session, 'mainnet');
    // Each request builds its own store: they still write one after the other.
    await Promise.all([
      pending.record('bze1a', send('A'), HEIGHT),
      pending.record('bze1b', send('B'), HEIGHT),
      new SessionPendingSends(session, 'mainnet').record('bze1c', send('C'), HEIGHT),
    ]);
    const later = NOW + PENDING_WINDOW_MS;
    expect(await pending.claim('bze1a', later)).toEqual([send('A')]);
    expect(await pending.claim('bze1b', later)).toEqual([send('B')]);
    expect(await pending.claim('bze1c', later)).toEqual([send('C')]);
  });

  it('ignores stored entries of any other shape', async () => {
    const session = memorySession();
    const pending = new SessionPendingSends(session, 'mainnet');
    await pending.record('bze1a', send('A'), HEIGHT);
    const [key] = [...session.data.keys()];
    if (key === undefined) throw new Error('nothing stored');
    session.data.set(key, {
      ...(session.data.get(key) as object),
      bze1b: [{ txHash: 'x' }],
      bze1c: 'nope',
    });
    const later = NOW + PENDING_WINDOW_MS;
    expect(await pending.claim('bze1b', later)).toEqual([]);
    expect(await pending.claim('bze1c', later)).toEqual([]);
    expect(await pending.claim('bze1a', later)).toEqual([send('A')]);
    await pending.release('bze1a');
    session.data.set(key, ['not', 'a', 'record']);
    expect(await pending.claim('bze1a', later)).toEqual([]);
  });
});
