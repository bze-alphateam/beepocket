import type { SessionStorage } from '../platform';
import type { Alarms } from '../features/wallet/alarms';
import type { PendingRequest } from './types';

export const REQUESTS_KEY = 'dapp.requests';
export const WINDOW_KEY = 'dapp.window';
export const DAPP_EXPIRY_ALARM = 'dapp-expiry';
/** A request nobody answered for this long ends with `expired`. */
export const REQUEST_TTL_MS = 10 * 60_000;
/** Pending requests in total, and per site: one hostile page cannot fill the queue. */
export const MAX_PENDING = 20;
export const MAX_PER_ORIGIN = 5;

export type AddResult =
  | { status: 'added'; evicted?: PendingRequest }
  | { status: 'queue-full' | 'origin-full' | 'duplicate' };

function valid(x: unknown): x is PendingRequest {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.origin === 'string' &&
    (r.network === 'mainnet' || r.network === 'testnet') &&
    typeof r.method === 'string' &&
    typeof r.tabId === 'number' &&
    typeof r.documentId === 'string' &&
    typeof r.createdAt === 'number'
  );
}

/**
 * The requests waiting for the user, oldest first. They live in session storage (not in the
 * worker's memory), because MV3 stops the worker while the user decides. Writes run one after
 * another so two requests arriving together cannot overwrite each other, and every write
 * re-arms the expiry alarm for the earliest request, so a stopped worker is woken in time.
 */
export class RequestStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly session: SessionStorage,
    private readonly alarms: Alarms,
    private readonly clock: { now(): number },
  ) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<PendingRequest[]> {
    const stored = await this.session.get(REQUESTS_KEY);
    return Array.isArray(stored) ? stored.filter(valid) : [];
  }

  private async write(list: PendingRequest[]): Promise<void> {
    await this.session.set(REQUESTS_KEY, list);
    if (list.length === 0) {
      await this.alarms.clear(DAPP_EXPIRY_ALARM);
      return;
    }
    const earliest = Math.min(...list.map((r) => r.createdAt)) + REQUEST_TTL_MS;
    await this.alarms.set(DAPP_EXPIRY_ALARM, Math.max(earliest - this.clock.now(), 0) / 60_000);
  }

  /** Oldest first. */
  list(): Promise<PendingRequest[]> {
    return this.exclusive(() => this.read());
  }

  /**
   * Appends the request unless the id is already queued or the site's share is full. When the
   * queue is full, a site with fewer waiting than the busiest one takes the place of that busiest
   * site's oldest request (handed back as `evicted`), so many sites cannot starve a new one.
   */
  add(request: PendingRequest): Promise<AddResult> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.some((r) => r.id === request.id)) return { status: 'duplicate' };
      const mine = all.filter((r) => r.origin === request.origin).length;
      if (mine >= MAX_PER_ORIGIN) return { status: 'origin-full' };
      if (all.length < MAX_PENDING) {
        await this.write([...all, request]);
        return { status: 'added' };
      }
      const counts = new Map<string, number>();
      for (const r of all) counts.set(r.origin, (counts.get(r.origin) ?? 0) + 1);
      let heaviest = '';
      let most = 0;
      for (const [origin, n] of counts) {
        if (n > most) {
          heaviest = origin;
          most = n;
        }
      }
      if (mine + 1 >= most) return { status: 'queue-full' };
      const evicted = all.find((r) => r.origin === heaviest);
      if (!evicted) return { status: 'queue-full' };
      await this.write([...all.filter((r) => r !== evicted), request]);
      return { status: 'added', evicted };
    });
  }

  /** Puts a claimed request back after its answer could not be completed. */
  restore(request: PendingRequest): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.some((r) => r.id === request.id)) return;
      await this.write([...all, request].sort((a, b) => a.createdAt - b.createdAt));
    });
  }

  /** Takes the request out; only one caller gets it. */
  claim(id: string): Promise<PendingRequest | undefined> {
    return this.exclusive(async () => {
      const all = await this.read();
      const found = all.find((r) => r.id === id);
      if (found) await this.write(all.filter((r) => r.id !== id));
      return found;
    });
  }

  /** Takes out every request that has waited its 10 minutes. */
  takeExpired(): Promise<PendingRequest[]> {
    return this.exclusive(async () => {
      const all = await this.read();
      const now = this.clock.now();
      const gone = all.filter((r) => now - r.createdAt >= REQUEST_TTL_MS);
      if (gone.length > 0) await this.write(all.filter((r) => !gone.includes(r)));
      return gone;
    });
  }

  /** Empties the queue (the window closed) and hands the requests back to be answered. */
  takeAll(): Promise<PendingRequest[]> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.length > 0) await this.write([]);
      return all;
    });
  }

  /** Forgets the requests of a closed tab; their pages are gone. */
  removeTab(tabId: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      const kept = all.filter((r) => r.tabId !== tabId);
      if (kept.length !== all.length) await this.write(kept);
    });
  }
}
