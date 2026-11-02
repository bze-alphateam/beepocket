import type { NetworkId } from '@beepocket/core';
import type { SessionStorage } from '../platform';

export const DOCUMENTS_KEY = 'dapp.tabs';
export const MAX_DOCUMENTS = 200;

/** A page document that talked to the wallet: where an `accountChanged` push can reach it. */
export interface KnownDocument {
  tabId: number;
  documentId: string;
  origin: string;
  network: NetworkId;
}

function valid(x: unknown): x is KnownDocument {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.tabId === 'number' &&
    typeof d.documentId === 'string' &&
    typeof d.origin === 'string' &&
    (d.network === 'mainnet' || d.network === 'testnet')
  );
}

/**
 * Which documents talked to which site on which network, kept in session storage (the worker
 * can stop at any time). Unique by `documentId`, at most `MAX_DOCUMENTS`, the oldest dropped.
 * Writes run one after another so two messages arriving together cannot overwrite each other.
 */
export class DocumentLog {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly session: SessionStorage) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<KnownDocument[]> {
    const stored = await this.session.get(DOCUMENTS_KEY);
    return Array.isArray(stored) ? stored.filter(valid) : [];
  }

  /** Oldest first. */
  list(): Promise<KnownDocument[]> {
    return this.exclusive(() => this.read());
  }

  /** Notes a document, newest last; a document seen again moves to the end with its latest state. */
  record(doc: KnownDocument): Promise<void> {
    return this.exclusive(async () => {
      const all = (await this.read()).filter((d) => d.documentId !== doc.documentId);
      all.push({
        tabId: doc.tabId,
        documentId: doc.documentId,
        origin: doc.origin,
        network: doc.network,
      });
      await this.session.set(DOCUMENTS_KEY, all.slice(-MAX_DOCUMENTS));
    });
  }

  /** Forgets documents (a push to them failed: the page is gone). */
  drop(documentIds: string[]): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      const kept = all.filter((d) => !documentIds.includes(d.documentId));
      if (kept.length !== all.length) await this.session.set(DOCUMENTS_KEY, kept);
    });
  }

  /** A closed tab holds no documents any more. */
  removeTab(tabId: number): Promise<void> {
    return this.exclusive(async () => {
      const all = await this.read();
      const kept = all.filter((d) => d.tabId !== tabId);
      if (kept.length !== all.length) await this.session.set(DOCUMENTS_KEY, kept);
    });
  }
}
