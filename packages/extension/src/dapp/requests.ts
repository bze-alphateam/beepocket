import type { SessionStorage } from '../platform';
import type { Alarms } from '../features/wallet/alarms';
import type { PendingRequest, QueuedRequest } from './types';

export const REQUESTS_KEY = 'dapp.requests';
/** Every request id queued lately; an id is not queued again while it is remembered. */
export const SEEN_KEY = 'dapp.seen';
/** The last ticket given to a queued request. */
export const TICKET_KEY = 'dapp.ticket';
export const WINDOW_KEY = 'dapp.window';
export const DAPP_EXPIRY_ALARM = 'dapp-expiry';
/** A request nobody answered for this long ends with `expired`. */
export const REQUEST_TTL_MS = 10 * 60_000;
/** Pending requests in total, and per site: one hostile page cannot fill the queue. */
export const MAX_PENDING = 20;
export const MAX_PER_ORIGIN = 5;
/**
 * Requests whose decision reads the node, decided at once in all. Per site they share
 * `MAX_PER_ORIGIN` with the site's queued requests.
 */
export const MAX_PREPARING = MAX_PENDING;
/**
 * Ids are remembered for `REQUEST_TTL_MS` after their last use. A site with this many remembered
 * has its new requests refused (none of its ids is forgotten early); past `MAX_SEEN` in all, the
 * oldest are forgotten, so busy sites cannot shut out the others.
 */
export const MAX_SEEN_PER_ORIGIN = 100;
export const MAX_SEEN = 1_000;

export type AddResult =
  | { status: 'added'; ticket: string; evicted?: QueuedRequest }
  | { status: 'queue-full' | 'origin-full' | 'duplicate' };

interface Seen {
  id: string;
  origin: string;
  at: number;
}

function validSeen(x: unknown): x is Seen {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.origin === 'string' && typeof r.at === 'number';
}

function valid(x: unknown): x is QueuedRequest {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.origin === 'string' &&
    (r.network === 'mainnet' || r.network === 'testnet') &&
    typeof r.method === 'string' &&
    typeof r.tabId === 'number' &&
    typeof r.documentId === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.ticket === 'string'
  );
}

/**
 * The requests waiting for the user, oldest first. They live in session storage (not in the
 * worker's memory), because MV3 stops the worker while the user decides. Writes run one after
 * another so two requests arriving together cannot overwrite each other, and every write
 * re-arms the expiry alarm for the earliest request, so a stopped worker is woken in time.
 * Each queued instance gets a ticket of its own, and an id once queued is not taken again while
 * it is remembered: taking a request out needs both its id and its ticket.
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

  private async read(): Promise<QueuedRequest[]> {
    const stored = await this.session.get(REQUESTS_KEY);
    return Array.isArray(stored) ? stored.filter(valid) : [];
  }

  /** The remembered ids, without those unused for `REQUEST_TTL_MS`. */
  private async readSeen(): Promise<Seen[]> {
    const stored = await this.session.get(SEEN_KEY);
    const now = this.clock.now();
    return Array.isArray(stored)
      ? stored.filter(validSeen).filter((e) => now - e.at < REQUEST_TTL_MS)
      : [];
  }

  /** Remembers the id as used now. */
  private async touch(request: PendingRequest): Promise<void> {
    const seen = (await this.readSeen()).filter((e) => e.id !== request.id);
    seen.push({ id: request.id, origin: request.origin, at: this.clock.now() });
    await this.session.set(SEEN_KEY, seen.slice(-MAX_SEEN));
  }

  private async nextTicket(): Promise<string> {
    const last = await this.session.get(TICKET_KEY);
    const next = (typeof last === 'number' && Number.isSafeInteger(last) ? last : 0) + 1;
    await this.session.set(TICKET_KEY, next);
    return String(next);
  }

  private async write(list: QueuedRequest[]): Promise<void> {
    await this.session.set(REQUESTS_KEY, list);
    if (list.length === 0) {
      await this.alarms.clear(DAPP_EXPIRY_ALARM);
      return;
    }
    const earliest = Math.min(...list.map((r) => r.createdAt)) + REQUEST_TTL_MS;
    await this.alarms.set(DAPP_EXPIRY_ALARM, Math.max(earliest - this.clock.now(), 0) / 60_000);
  }

  /** Oldest first. */
  list(): Promise<QueuedRequest[]> {
    return this.exclusive(() => this.read());
  }

  /**
   * Appends the request under a new ticket unless its id is queued or was used lately, or the
   * site's share is full. When the queue is full, a site with fewer waiting than the busiest one
   * takes the place of that busiest site's oldest request (handed back as `evicted`), so many
   * sites cannot starve a new one.
   */
  add(request: PendingRequest): Promise<AddResult> {
    return this.exclusive(async () => {
      const all = await this.read();
      const seen = await this.readSeen();
      if (all.some((r) => r.id === request.id) || seen.some((e) => e.id === request.id)) {
        return { status: 'duplicate' };
      }
      const mine = all.filter((r) => r.origin === request.origin).length;
      if (mine >= MAX_PER_ORIGIN) return { status: 'origin-full' };
      if (seen.filter((e) => e.origin === request.origin).length >= MAX_SEEN_PER_ORIGIN) {
        return { status: 'origin-full' };
      }
      let evicted: QueuedRequest | undefined;
      if (all.length >= MAX_PENDING) {
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
        evicted = all.find((r) => r.origin === heaviest);
        if (!evicted) return { status: 'queue-full' };
      }
      const ticket = await this.nextTicket();
      await this.touch(request);
      await this.write([...all.filter((r) => r !== evicted), { ...request, ticket }]);
      return evicted ? { status: 'added', ticket, evicted } : { status: 'added', ticket };
    });
  }

  /**
   * Puts a claimed request back after its answer could not be completed. Should another instance
   * hold its id meanwhile, that one is taken out and handed back to be refused: the request the
   * user reviewed is never dropped for it.
   */
  restore(request: QueuedRequest): Promise<QueuedRequest | undefined> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.some((r) => r.id === request.id && r.ticket === request.ticket)) return undefined;
      const displaced = all.find((r) => r.id === request.id);
      const kept = all.filter((r) => r.id !== request.id);
      await this.touch(request);
      await this.write([...kept, request].sort((a, b) => a.createdAt - b.createdAt));
      return displaced;
    });
  }

  /** Takes out the request with this id and ticket; only one caller gets it. */
  claim(id: string, ticket: string): Promise<QueuedRequest | undefined> {
    return this.exclusive(async () => {
      const all = await this.read();
      const found = all.find((r) => r.id === id && r.ticket === ticket);
      if (!found) return undefined;
      await this.touch(found);
      await this.write(all.filter((r) => r !== found));
      return found;
    });
  }

  /** Takes out every request that has waited its 10 minutes. */
  takeExpired(): Promise<QueuedRequest[]> {
    return this.exclusive(async () => {
      const all = await this.read();
      const now = this.clock.now();
      const gone = all.filter((r) => now - r.createdAt >= REQUEST_TTL_MS);
      if (gone.length > 0) await this.write(all.filter((r) => !gone.includes(r)));
      return gone;
    });
  }

  /** Empties the queue (the window closed) and hands the requests back to be answered. */
  takeAll(): Promise<QueuedRequest[]> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.length > 0) await this.write([]);
      return all;
    });
  }

  /** Takes out a request its page gave up on; only the document that sent it can. */
  cancel(id: string, tabId: number, documentId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const all = await this.read();
      const kept = all.filter(
        (r) => !(r.id === id && r.tabId === tabId && r.documentId === documentId),
      );
      if (kept.length === all.length) return false;
      await this.write(kept);
      return true;
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
