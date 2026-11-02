import type { SessionStorage } from '../platform';
import type { PendingRequest } from './types';

export const REQUESTS_KEY = 'dapp.requests';
export const WINDOW_KEY = 'dapp.window';

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
 * The requests waiting for the user. They live in session storage (not in the worker's
 * memory), because MV3 stops the worker while the user decides. Writes run one after another
 * so two requests arriving together cannot overwrite each other.
 */
export class RequestStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly session: SessionStorage) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<PendingRequest[]> {
    const stored = await this.session.get(REQUESTS_KEY);
    return Array.isArray(stored) ? stored.filter(valid) : [];
  }

  /** Oldest first. */
  list(): Promise<PendingRequest[]> {
    return this.exclusive(() => this.read());
  }

  /** Stores the request only when no other waits (one at a time); says whether it did. */
  addIfNone(request: PendingRequest): Promise<boolean> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.length > 0) return false;
      await this.session.set(REQUESTS_KEY, [request]);
      return true;
    });
  }

  /** Puts a claimed request back after its answer could not be completed. */
  restore(request: PendingRequest): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      if (all.some((r) => r.id === request.id)) return;
      await this.session.set(
        REQUESTS_KEY,
        [...all, request].sort((a, b) => a.createdAt - b.createdAt),
      );
    });
  }

  /** Takes the request out; only one caller gets it. */
  claim(id: string): Promise<PendingRequest | undefined> {
    return this.exclusive(async () => {
      const all = await this.read();
      const found = all.find((r) => r.id === id);
      if (found)
        await this.session.set(
          REQUESTS_KEY,
          all.filter((r) => r.id !== id),
        );
      return found;
    });
  }

  /** Forgets the requests of a closed tab; their pages are gone. */
  removeTab(tabId: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      const kept = all.filter((r) => r.tabId !== tabId);
      if (kept.length !== all.length) await this.session.set(REQUESTS_KEY, kept);
    });
  }
}
