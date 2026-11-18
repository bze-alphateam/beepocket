import { describe, expect, it } from 'vitest';
import type { SessionStorage } from '../../platform';
import { SessionPendingSends, type PendingSend } from './pending';

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

const send = (hash: string): PendingSend => ({
  txHash: hash,
  sequence: '5',
  timeoutHeight: '1030',
  signedAt: 1_000,
});

describe('SessionPendingSends', () => {
  it('keeps one send per address, apart for each network', async () => {
    const session = memorySession();
    const mainnet = new SessionPendingSends(session, 'mainnet');
    const testnet = new SessionPendingSends(session, 'testnet');
    await mainnet.record('bze1a', send('A'.repeat(64)));
    await mainnet.record('bze1b', send('B'.repeat(64)));

    expect(await mainnet.get('bze1a')).toEqual(send('A'.repeat(64)));
    expect(await mainnet.get('bze1b')).toEqual(send('B'.repeat(64)));
    expect(await testnet.get('bze1a')).toBeNull();

    await mainnet.record('bze1a', send('C'.repeat(64)));
    expect(await mainnet.get('bze1a')).toEqual(send('C'.repeat(64)));
  });

  it('forgets a send by its hash, in either case, and only that one', async () => {
    const pending = new SessionPendingSends(memorySession(), 'mainnet');
    await pending.record('bze1a', send('A'.repeat(64)));
    await pending.record('bze1b', send('B'.repeat(64)));
    await pending.settle('a'.repeat(64));
    expect(await pending.get('bze1a')).toBeNull();
    expect(await pending.get('bze1b')).toEqual(send('B'.repeat(64)));
  });

  it('ignores stored entries of any other shape', async () => {
    const session = memorySession();
    const pending = new SessionPendingSends(session, 'mainnet');
    await pending.record('bze1a', send('A'.repeat(64)));
    const [key] = [...session.data.keys()];
    if (key === undefined) throw new Error('nothing stored');
    session.data.set(key, { ...(session.data.get(key) as object), bze1b: { txHash: 'x' } });
    expect(await pending.get('bze1b')).toBeNull();
    expect(await pending.get('bze1a')).toEqual(send('A'.repeat(64)));
    session.data.set(key, ['not', 'a', 'record']);
    expect(await pending.get('bze1a')).toBeNull();
  });
});
