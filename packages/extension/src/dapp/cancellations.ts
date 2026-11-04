import type { DappSender } from './types';

/** At most this many cancelled requests are remembered; the oldest are forgotten first. */
const MAX_CANCELLED = 100;

/** Whether the page that sent a request gave up on it. */
export interface CancelledRequests {
  has(request: { id: string; tabId: number; documentId: string }): boolean;
}

/**
 * Requests their page gave up on (no ack in time, or restored from the back/forward cache). Kept
 * in the worker's memory only: they matter while the request is still being handled, which is
 * the same worker. A cancel counts only for the document that sent the request.
 */
export class Cancellations implements CancelledRequests {
  private readonly keys = new Set<string>();

  add(from: DappSender, id: string): void {
    this.keys.add(key(from.tabId, from.documentId, id));
    if (this.keys.size > MAX_CANCELLED) {
      const oldest = this.keys.values().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
  }

  has(request: { id: string; tabId: number; documentId: string }): boolean {
    return this.keys.has(key(request.tabId, request.documentId, request.id));
  }
}

function key(tabId: number, documentId: string, id: string): string {
  return JSON.stringify([tabId, documentId, id]);
}
