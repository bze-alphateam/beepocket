import {
  shortAddress,
  type ActivityRow,
  type Clock,
  type ScanBalance,
  type ScanClient,
} from '@beepocket/core';
import {
  ActivityErrorCodes,
  fail,
  ok,
  type ActivityAmount,
  type ActivityItem,
  type ActivityPageResult,
  type Result,
  type WalletAddress,
} from '../../protocol';

const PAGE_SIZE = 10;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Longer than the transport's own timeout, so that one normally wins; this one guards any other transport. */
const SCAN_TIMEOUT_MS = 20_000;

/** The wallet's addresses, in derivation order; an error result while the wallet is locked. */
export interface ActivityAddresses {
  list(): Promise<Result<WalletAddress[]>>;
}

export interface ActivityServiceDeps {
  scan: ScanClient;
  /** Explorer base URL of the active network, no trailing slash. */
  explorer: string;
  addresses: ActivityAddresses;
  clock: Pick<Clock, 'now' | 'sleep'>;
}

/** Where one address stands: rows fetched but not yet shown, and the way to its older rows. */
interface Lane {
  index: number;
  fetched: boolean;
  /** Scan cursor of the next older page; null when Scan has nothing older (or all is past the cutoff). */
  next: string | null;
  buffer: ActivityItem[];
}

/** What the opaque cursor carries between calls. */
interface CursorState {
  v: 2;
  /** Epoch ms of the first load minus 30 days; every later page uses the same one. */
  cutoff: number;
  lanes: Lane[];
}

const exhausted = (lane: Lane) => lane.fetched && lane.next === null && lane.buffer.length === 0;

/** Newest first; equal times by address index, then transaction hash. */
function newer(a: ActivityItem, b: ActivityItem): boolean {
  const ta = Date.parse(a.time);
  const tb = Date.parse(b.time);
  if (ta !== tb) return ta > tb;
  if (a.addressIndex !== b.addressIndex) return a.addressIndex < b.addressIndex;
  return (a.txHash ?? '') < (b.txHash ?? '');
}

const abs = (n: bigint) => (n < 0n ? -n : n);

/** Non-zero changes only, one entry per denom, largest absolute value first. */
function amountsOf(balances: ScanBalance[], sign: 1n | -1n): ActivityAmount[] {
  const sums = new Map<string, { n: bigint; symbol: string | null; exponent: number | null }>();
  for (const b of balances) {
    const seen = sums.get(b.denom);
    sums.set(b.denom, {
      n: (seen?.n ?? 0n) + sign * b.amount,
      symbol: seen?.symbol ?? b.symbol,
      exponent: seen?.exponent ?? b.exponent,
    });
  }
  return [...sums.entries()]
    .filter(([, v]) => v.n !== 0n)
    .sort(([, x], [, y]) => (abs(x.n) === abs(y.n) ? 0 : abs(x.n) > abs(y.n) ? -1 : 1))
    .map(([denom, v]) => ({
      denom,
      amount: v.n.toString(),
      symbol: v.symbol,
      exponent: v.exponent,
    }));
}

function toItem(row: ActivityRow, address: WalletAddress): ActivityItem {
  const deltas = amountsOf(row.deltas, 1n);
  const fees = amountsOf(row.fee ?? [], -1n);
  const feeOnly = deltas.length === 0 && fees.length > 0;
  const cp = row.counterparty;
  return {
    addressIndex: address.index,
    addressLabel: address.label,
    time: row.time,
    txHash: row.txHash,
    kind: row.kind,
    category: row.category,
    isSigner: row.isSigner,
    success: row.success,
    counterparty: cp === null ? null : (cp.label?.name ?? cp.moniker ?? shortAddress(cp.address)),
    amounts: feeOnly ? fees : deltas,
    feeOnly,
  };
}

function parseCursor(raw: string): CursorState | null {
  try {
    const s = JSON.parse(raw) as Partial<CursorState> | null;
    if (
      s?.v !== 2 ||
      typeof s.cutoff !== 'number' ||
      !Array.isArray(s.lanes) ||
      s.lanes.length === 0 ||
      !s.lanes.every(
        (l) =>
          Number.isInteger(l.index) &&
          typeof l.fetched === 'boolean' &&
          (l.next === null || typeof l.next === 'string') &&
          Array.isArray(l.buffer),
      )
    ) {
      return null;
    }
    return s as CursorState;
  } catch {
    return null;
  }
}

/**
 * The wallet's whole activity across the wallet's addresses: a k-way merge over Scan's per-address
 * feeds. A call works on a copy of the cursor state and only hands the advanced state back on
 * success, so a failed call can simply be repeated with the same cursor.
 */
export class ActivityService {
  constructor(private readonly deps: ActivityServiceDeps) {}

  async page(req: { addressIndex?: number; cursor?: string }): Promise<Result<ActivityPageResult>> {
    const listed = await this.deps.addresses.list();
    if (!listed.ok) return listed;
    const addresses = listed.value;

    let state: CursorState;
    if (req.cursor !== undefined) {
      const parsed = parseCursor(req.cursor);
      if (!parsed?.lanes.every((l) => addresses.some((a) => a.index === l.index))) {
        return fail(ActivityErrorCodes.badCursor, 'That activity cursor is not valid.');
      }
      state = parsed;
    } else {
      const chosen =
        req.addressIndex === undefined
          ? addresses
          : addresses.filter((a) => a.index === req.addressIndex);
      if (chosen.length === 0) {
        return fail(ActivityErrorCodes.unknownAddress, 'No such address in this wallet.');
      }
      state = {
        v: 2,
        cutoff: this.deps.clock.now() - WINDOW_MS,
        lanes: chosen.map((a) => ({ index: a.index, fetched: false, next: null, buffer: [] })),
      };
    }
    const byIndex = new Map(addresses.map((a) => [a.index, a]));

    const items: ActivityItem[] = [];
    try {
      while (items.length < PAGE_SIZE) {
        const empty = state.lanes.filter((l) => l.buffer.length === 0 && !exhausted(l));
        await Promise.all(
          empty.map(async (l) => {
            const address = byIndex.get(l.index);
            if (address) await this.fill(l, state, address);
          }),
        );
        let best: Lane | null = null;
        for (const lane of state.lanes) {
          const head = lane.buffer[0];
          const top = best?.buffer[0];
          if (head && (!top || newer(head, top))) best = lane;
        }
        const next = best?.buffer.shift();
        if (!next) break;
        items.push(next);
      }
    } catch {
      return fail(ActivityErrorCodes.unavailable, 'Activity is not available right now.');
    }

    const done = state.lanes.every(exhausted);
    const first = byIndex.get(state.lanes[0]?.index ?? -1) ?? addresses[0];
    return ok({
      items,
      cursor: done ? null : JSON.stringify(state),
      done,
      explorer: `${this.deps.explorer}/accounts/${first?.address ?? ''}`,
    });
  }

  private async fill(lane: Lane, state: CursorState, address: WalletAddress): Promise<void> {
    const page = await Promise.race([
      this.deps.scan.activity(address.address, {
        limit: PAGE_SIZE,
        ...(lane.next === null ? {} : { cursor: lane.next }),
      }),
      this.deps.clock.sleep(SCAN_TIMEOUT_MS).then(() => {
        throw new Error('Scan did not answer in time');
      }),
    ]);
    const kept = page.items.filter((row) => !(Date.parse(row.time) < state.cutoff));
    lane.fetched = true;
    lane.buffer.push(...kept.map((row) => toItem(row, address)));
    // Rows come newest first: a dropped row means everything after it is older still.
    const pastCutoff = kept.length < page.items.length;
    lane.next = pastCutoff || page.items.length === 0 ? null : page.nextCursor;
  }
}
