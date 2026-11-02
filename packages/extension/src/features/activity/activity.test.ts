import type { ActivityPage, ActivityQuery, ActivityRow, ScanClient } from '@beepocket/core';
import { describe, expect, it, vi } from 'vitest';
import { HandlerRegistry } from '../../background/registry';
import { ActivityErrorCodes, type ActivityPageResult, type Result } from '../../protocol';
import { registerActivityHandlers } from './handlers';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const DENOM = 'ubze';
const ADDRS = [0, 1, 2, 3].map((i) => ({
  index: i,
  label: `Addr ${String(i)}`,
  address: `bze1addr${String(i)}`,
}));

const ago = (ms: number) => new Date(NOW - ms).toISOString();

function row(over: Partial<ActivityRow> & { time: string }): ActivityRow {
  return {
    height: 1,
    txHash: 'AA',
    kind: 'send',
    category: 'received',
    isSigner: false,
    success: true,
    counterparty: null,
    deltas: [{ denom: DENOM, amount: 5n, symbol: 'BZE', exponent: 6 }],
    msgTypes: [],
    fee: null,
    ...over,
  };
}

/** A Scan whose per-address feeds page by offset, like the real cursor does. */
function fakeScan(feeds: Record<string, ActivityRow[]>) {
  const activity = vi.fn((address: string, q: ActivityQuery): Promise<ActivityPage> => {
    const all = feeds[address] ?? [];
    const from = q.cursor === undefined ? 0 : Number(q.cursor);
    const items = all.slice(from, from + q.limit);
    const end = from + items.length;
    return Promise.resolve({ items, nextCursor: end < all.length ? String(end) : null });
  });
  const scan: ScanClient = { activity, token: () => Promise.resolve(null) };
  return { scan, activity };
}

function setup(feeds: Record<string, ActivityRow[]>, addresses = ADDRS) {
  const { scan, activity } = fakeScan(feeds);
  const registry = new HandlerRegistry();
  // `sleep` never ends unless a test says Scan hangs: then it is the timeout that fires.
  const clock = {
    t: NOW,
    hang: false,
    now: () => clock.t,
    sleep: () => (clock.hang ? Promise.resolve() : new Promise<void>(() => undefined)),
  };
  registerActivityHandlers(registry, {
    platform: { clock },
    services: {
      clients: () => Promise.resolve({ network: { scan: 'https://explorer.example' }, scan }),
    },
    wallet: { addresses: () => Promise.resolve({ ok: true, value: { addresses } }) },
  } as never);
  const page = async (payload: unknown) =>
    (await registry.dispatch({ method: 'activity.page', payload })) as Result<ActivityPageResult>;
  return { page, activity, clock, scan };
}

const valueOf = (r: Result<ActivityPageResult>) => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

const feedOf = (count: number, start: number, step: number, hash: string) =>
  Array.from({ length: count }, (_, i) =>
    row({ time: ago(start + i * step), txHash: `${hash}${String(i)}` }),
  );

describe('activity.page', () => {
  it('merges addresses newest first, 10 at a time, without skipping or repeating a row', async () => {
    const feeds = {
      bze1addr0: feedOf(12, 1000, 3000, 'A'),
      bze1addr1: feedOf(9, 2000, 3000, 'B'),
      bze1addr2: feedOf(7, 3000, 3000, 'C'),
    };
    const { page } = setup(feeds, ADDRS.slice(0, 3));
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const v = valueOf(await page({ ...(cursor ? { cursor } : {}) }));
      pages++;
      expect(v.items.length).toBeLessThanOrEqual(10);
      seen.push(...v.items.map((i) => i.txHash ?? ''));
      if (v.done) {
        expect(v.cursor).toBeNull();
        break;
      }
      expect(v.items).toHaveLength(10);
      cursor = v.cursor ?? undefined;
    }
    const expected = Object.values(feeds)
      .flat()
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
      .map((r) => r.txHash);
    expect(pages).toBe(3);
    expect(seen).toEqual(expected);
  });

  it('orders equal timestamps by address index, then tx hash', async () => {
    const t = ago(1000);
    const { page } = setup(
      {
        bze1addr0: [row({ time: t, txHash: 'B1' }), row({ time: t, txHash: 'B2' })],
        bze1addr1: [row({ time: t, txHash: 'A0' })],
        bze1addr2: [row({ time: t, txHash: 'A9' })],
      },
      ADDRS.slice(0, 3),
    );
    const v = valueOf(await page({}));
    expect(v.items.map((i) => `${String(i.addressIndex)}:${i.txHash ?? ''}`)).toEqual([
      '0:B1',
      '0:B2',
      '1:A0',
      '2:A9',
    ]);
  });

  it('asks Scan for 10 rows and the address cursor, never for a denom', async () => {
    const { page, activity } = setup({ bze1addr0: feedOf(12, 1000, 1000, 'A') }, ADDRS.slice(0, 1));
    const first = valueOf(await page({}));
    expect(activity).toHaveBeenCalledWith('bze1addr0', { limit: 10 });
    await page({ cursor: first.cursor ?? '' });
    expect(activity.mock.calls.at(-1)?.[1]).toMatchObject({ cursor: '10' });
    for (const [, query] of activity.mock.calls) expect(query).not.toHaveProperty('denom');
  });

  it('pages one address only in single-address mode', async () => {
    const { page, activity } = setup({
      bze1addr0: feedOf(3, 1000, 1000, 'A'),
      bze1addr1: feedOf(3, 500, 1000, 'B'),
    });
    const v = valueOf(await page({ addressIndex: 1 }));
    expect(v.items.map((i) => i.txHash)).toEqual(['B0', 'B1', 'B2']);
    expect(v.explorer).toBe('https://explorer.example/accounts/bze1addr1');
    expect(activity.mock.calls.map((c) => c[0])).toEqual(['bze1addr1']);
  });

  it('refuses an address the wallet does not have', async () => {
    const { page } = setup({});
    const r = await page({ addressIndex: 9 });
    expect(r).toMatchObject({ ok: false, error: { code: ActivityErrorCodes.unknownAddress } });
  });

  it('drops rows older than 30 days mid-page and reports done, pinning the cutoff to the first load', async () => {
    const feed = [
      row({ time: ago(1 * DAY), txHash: 'N1' }),
      row({ time: ago(29 * DAY), txHash: 'N2' }),
      row({ time: ago(31 * DAY), txHash: 'O1' }),
      row({ time: ago(40 * DAY), txHash: 'O2' }),
    ];
    const { page, clock } = setup({ bze1addr0: feed }, ADDRS.slice(0, 1));
    clock.t = NOW;
    const v = valueOf(await page({}));
    expect(v.items.map((i) => i.txHash)).toEqual(['N1', 'N2']);
    expect(v.done).toBe(true);
    expect(v.cursor).toBeNull();
  });

  it('keeps the cutoff of the first load on later pages', async () => {
    // 15 rows from 14 to 28 days back: all inside the first load's window.
    const feed = Array.from({ length: 15 }, (_, i) =>
      row({ time: ago((14 + i) * DAY), txHash: `D${String(i)}` }),
    );
    const { page, clock } = setup({ bze1addr0: feed }, ADDRS.slice(0, 1));
    const first = valueOf(await page({}));
    clock.t = NOW + 20 * DAY;
    const next = valueOf(await page({ cursor: first.cursor ?? '' }));
    expect(next.items).toHaveLength(5);
    expect(next.done).toBe(true);
  });

  it('is done when every address runs out before 10 rows', async () => {
    const { page } = setup(
      { bze1addr0: feedOf(2, 1000, 1000, 'A'), bze1addr2: [] },
      ADDRS.slice(0, 3),
    );
    const v = valueOf(await page({}));
    expect(v.items).toHaveLength(2);
    expect(v.done).toBe(true);
  });

  it('answers an empty, done feed for an address with no activity', async () => {
    const { page } = setup({}, ADDRS.slice(0, 1));
    expect(valueOf(await page({}))).toMatchObject({ items: [], done: true });
  });

  it('shows one row per address for the same transaction, labelled', async () => {
    const t = ago(1000);
    const { page } = setup(
      {
        bze1addr0: [row({ time: t, txHash: 'SAME', category: 'sent', isSigner: true })],
        bze1addr1: [row({ time: t, txHash: 'SAME' })],
      },
      ADDRS.slice(0, 2),
    );
    const v = valueOf(await page({}));
    expect(v.items.map((i) => [i.addressIndex, i.addressLabel])).toEqual([
      [0, 'Addr 0'],
      [1, 'Addr 1'],
    ]);
  });

  it('keeps the cursor valid after a Scan error so a retry resumes', async () => {
    const feeds = {
      bze1addr0: feedOf(15, 1000, 1000, 'A'),
      bze1addr1: feedOf(15, 1500, 1000, 'B'),
    };
    const { page, activity } = setup(feeds, ADDRS.slice(0, 2));
    const first = valueOf(await page({}));
    const working = activity.getMockImplementation();
    if (!working) throw new Error('no scan implementation');
    activity.mockImplementation(() => Promise.reject(new Error('scan down')));
    const failed = await page({ cursor: first.cursor ?? '' });
    expect(failed).toMatchObject({ ok: false, error: { code: ActivityErrorCodes.unavailable } });
    activity.mockImplementation(working);
    const retried = valueOf(await page({ cursor: first.cursor ?? '' }));
    const all = [...first.items, ...retried.items].map((i) => i.txHash);
    expect(new Set(all).size).toBe(all.length);
    const expected = Object.values(feeds)
      .flat()
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
      .map((r) => r.txHash)
      .slice(0, 20);
    expect(all).toEqual(expected);
  });

  it('turns fee-only rows into a negative fee and plain rows into their signed deltas', async () => {
    const { page } = setup(
      {
        bze1addr0: [
          row({
            time: ago(1000),
            txHash: 'FEE',
            kind: 'fee_only',
            category: 'other',
            deltas: [],
            fee: [{ denom: DENOM, amount: 7n, symbol: 'BZE', exponent: 6 }],
          }),
          row({
            time: ago(2000),
            txHash: 'OUT',
            category: 'sent',
            deltas: [{ denom: DENOM, amount: -40n, symbol: 'BZE', exponent: 6 }],
          }),
          row({ time: ago(3000), txHash: 'NONE', deltas: [], fee: null }),
          row({
            time: ago(4000),
            txHash: 'ZERO',
            deltas: [{ denom: DENOM, amount: 0n, symbol: 'BZE', exponent: 6 }],
          }),
        ],
      },
      ADDRS.slice(0, 1),
    );
    const v = valueOf(await page({}));
    expect(v.items.map((i) => [i.txHash, i.amounts.map((a) => a.amount), i.feeOnly])).toEqual([
      ['FEE', ['-7'], true],
      ['OUT', ['-40'], false],
      ['NONE', [], false],
      ['ZERO', [], false],
    ]);
  });

  it('names the counterparty by label, then moniker, then short address, and omits it when null', async () => {
    const cp = (label: string | null, moniker: string | null) => ({
      address: 'bze1counterpartyaddressxxxxxxxxxxxxxxxxxxxxx',
      label: label === null ? null : { name: label, kind: 'exchange' },
      moniker,
    });
    const { page } = setup(
      {
        bze1addr0: [
          row({ time: ago(1000), txHash: '1', counterparty: cp('Exchange', 'val') }),
          row({ time: ago(2000), txHash: '2', counterparty: cp(null, 'val') }),
          row({ time: ago(3000), txHash: '3', counterparty: cp(null, null) }),
          row({ time: ago(4000), txHash: '4', counterparty: null }),
        ],
      },
      ADDRS.slice(0, 1),
    );
    const v = valueOf(await page({}));
    expect(v.items.map((i) => i.counterparty)).toEqual([
      'Exchange',
      'val',
      expect.stringContaining('…'),
      null,
    ]);
    // The full address travels too, so the popup can name it from the address book.
    const full = 'bze1counterpartyaddressxxxxxxxxxxxxxxxxxxxxx';
    expect(v.items.map((i) => i.counterpartyAddress)).toEqual([full, full, full, null]);
  });

  it('rejects a cursor that is not its own and a bad payload', async () => {
    const { page } = setup({ bze1addr0: feedOf(15, 1000, 1000, 'A') }, ADDRS.slice(0, 1));
    for (const cursor of ['nope', '{"v":1}', '{"v":2}']) {
      const r = await page({ cursor });
      expect(r).toMatchObject({ ok: false, error: { code: ActivityErrorCodes.badCursor } });
    }
    expect(await page({ addressIndex: 'x' })).toMatchObject({ ok: false });
    expect(await page({ cursor: 5 })).toMatchObject({ ok: false });
  });

  it('passes a locked wallet through', async () => {
    const registry = new HandlerRegistry();
    registerActivityHandlers(registry, {
      platform: { clock: { now: () => NOW } },
      services: { clients: () => Promise.resolve({ network: { scan: 'x' }, scan: {} }) },
      wallet: {
        addresses: () =>
          Promise.resolve({ ok: false, error: { code: 'wallet_locked', message: 'locked' } }),
      },
    } as never);
    const r = await registry.dispatch({ method: 'activity.page', payload: {} });
    expect(r).toMatchObject({ ok: false, error: { code: 'wallet_locked' } });
  });

  it('times out a Scan that never answers, and the same cursor works once Scan is back', async () => {
    const feeds = { bze1addr0: feedOf(15, 1000, 1000, 'A') };
    const { page, activity, clock } = setup(feeds, ADDRS.slice(0, 1));
    const first = valueOf(await page({}));
    const working = activity.getMockImplementation();
    if (!working) throw new Error('no scan implementation');
    activity.mockImplementation(() => new Promise<ActivityPage>(() => undefined));
    clock.hang = true;
    const failed = await page({ cursor: first.cursor ?? '' });
    expect(failed).toMatchObject({ ok: false, error: { code: ActivityErrorCodes.unavailable } });
    activity.mockImplementation(working);
    clock.hang = false;
    const retried = valueOf(await page({ cursor: first.cursor ?? '' }));
    expect(retried.items.map((i) => i.txHash)).toEqual(['A10', 'A11', 'A12', 'A13', 'A14']);
  });

  it('lists every non-zero delta, largest first, merging a denom that appears twice', async () => {
    const { page } = setup(
      {
        bze1addr0: [
          row({
            time: ago(1000),
            txHash: 'SWAP',
            kind: 'dex_swap',
            category: 'other',
            isSigner: true,
            deltas: [
              { denom: DENOM, amount: -9n, symbol: 'BZE', exponent: 6 },
              { denom: 'uother', amount: 40n, symbol: null, exponent: null },
              { denom: 'uthird', amount: -2n, symbol: 'T', exponent: 2 },
              { denom: DENOM, amount: -1n, symbol: 'BZE', exponent: 6 },
            ],
            fee: [{ denom: DENOM, amount: 3n, symbol: 'BZE', exponent: 6 }],
          }),
        ],
      },
      ADDRS.slice(0, 1),
    );
    const v = valueOf(await page({}));
    expect(v.items[0]).toMatchObject({ feeOnly: false });
    expect(v.items[0]?.amounts).toEqual([
      { denom: 'uother', amount: '40', symbol: null, exponent: null },
      { denom: DENOM, amount: '-10', symbol: 'BZE', exponent: 6 },
      { denom: 'uthird', amount: '-2', symbol: 'T', exponent: 2 },
    ]);
  });

  it('orders equal absolute amounts by denom, whatever order Scan lists them in', async () => {
    const { page } = setup(
      {
        bze1addr0: [
          row({
            time: ago(1000),
            deltas: [
              { denom: 'ubbb', amount: 5n, symbol: null, exponent: null },
              { denom: 'uccc', amount: -5n, symbol: null, exponent: null },
              { denom: 'uaaa', amount: 5n, symbol: null, exponent: null },
            ],
          }),
        ],
      },
      ADDRS.slice(0, 1),
    );
    const v = valueOf(await page({}));
    expect(v.items[0]?.amounts.map((a) => a.denom)).toEqual(['uaaa', 'ubbb', 'uccc']);
  });
});
