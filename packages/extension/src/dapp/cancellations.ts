import type { SessionStorage } from '../platform';
import type { DappSender } from './types';

export const IN_FLIGHT_KEY = 'dapp.inflight';
/** Requests one site may have in hand at once, before they are answered or queued. */
export const MAX_IN_FLIGHT_PER_ORIGIN = 50;
/** A record older than this belongs to a worker that stopped: it is forgotten. */
const STALE_MS = 10 * 60_000;

/** Whether the page that sent a request gave up on it. */
export interface CancelledRequests {
  has(request: { id: string; tabId: number; documentId: string }): Promise<boolean>;
}

/** Whether a new request was taken in hand, or why not. */
export type SentResult = 'ok' | 'duplicate' | 'full';

interface InFlight {
  origin: string;
  tabId: number;
  documentId: string;
  id: string;
  cancelled: boolean;
  at: number;
}

function valid(x: unknown): x is InFlight {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.origin === 'string' &&
    typeof r.tabId === 'number' &&
    typeof r.documentId === 'string' &&
    typeof r.id === 'string' &&
    typeof r.cancelled === 'boolean' &&
    typeof r.at === 'number'
  );
}

const same = (
  r: { id: string; tabId: number; documentId: string },
  tabId: number,
  documentId: string,
  id: string,
) => r.id === id && r.tabId === tabId && r.documentId === documentId;

/**
 * The requests being handled (acked, not yet answered or queued), per sending document, and
 * whether their page gave up on them (no ack in time, or restored from the back/forward cache).
 * A cancel counts only for a request its own document sent. Records are kept per document,
 * within a bounded share per site, and are never evicted: past the share, a site's new requests
 * are refused. Kept in session storage, written one
 * change at a time in arrival order: a cancel that arrives right after its request finds it.
 */
export class Cancellations implements CancelledRequests {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly session: SessionStorage,
    private readonly clock: { now(): number },
  ) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<InFlight[]> {
    const stored = await this.session.get(IN_FLIGHT_KEY);
    const now = this.clock.now();
    return Array.isArray(stored) ? stored.filter(valid).filter((r) => now - r.at < STALE_MS) : [];
  }

  /**
   * The page sent this request; until it is settled, the page may cancel it. Every request in
   * hand has its record: one the document already has in hand, or one past the site's share, is
   * not taken.
   */
  sent(from: DappSender, id: string): Promise<SentResult> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.some((r) => same(r, from.tabId, from.documentId, id))) return 'duplicate';
      if (all.filter((r) => r.origin === from.origin).length >= MAX_IN_FLIGHT_PER_ORIGIN) {
        return 'full';
      }
      all.push({ ...from, id, cancelled: false, at: this.clock.now() });
      await this.session.set(IN_FLIGHT_KEY, all);
      return 'ok';
    });
  }

  /** The page gave up on a request it sent; a cancel for anything else is ignored. */
  cancel(from: DappSender, id: string): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      const found = all.find((r) => same(r, from.tabId, from.documentId, id));
      if (!found || found.cancelled) return;
      found.cancelled = true;
      await this.session.set(IN_FLIGHT_KEY, all);
    });
  }

  has(request: { id: string; tabId: number; documentId: string }): Promise<boolean> {
    return this.exclusive(async () =>
      (await this.read()).some(
        (r) => r.cancelled && same(r, request.tabId, request.documentId, request.id),
      ),
    );
  }

  /** The request was answered, queued or dropped: it is no longer being handled. */
  settled(from: DappSender, id: string): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      const kept = all.filter((r) => !same(r, from.tabId, from.documentId, id));
      if (kept.length !== all.length) await this.session.set(IN_FLIGHT_KEY, kept);
    });
  }
}
