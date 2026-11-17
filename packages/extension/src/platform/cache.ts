import type { Cache, Clock } from '@beepocket/core';
import type { CacheStorage } from './ports';

interface Entry {
  value: unknown;
  expires: number;
}

interface Stored {
  bytes: number;
  expires: number;
}

const PREFIX = 'cache:';
/** Nothing is kept longer than this, whatever TTL a caller asks for. */
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
/** Writes between two reads of what is actually stored, which picks up other workers' writes. */
const RESCAN_EVERY = 64;

export interface StorageCacheOptions {
  /** Most entries kept at once. */
  maxEntries?: number;
  /** Most bytes the entries take, counted as `chrome.storage` counts them. */
  maxBytes?: number;
  /** Room under the storage quota the cache never writes into: it belongs to the wallet. */
  reserveBytes?: number;
}

const DEFAULTS: Required<StorageCacheOptions> = {
  maxEntries: 500,
  maxBytes: 1024 * 1024,
  reserveBytes: 1024 * 1024,
};

function isEntry(raw: unknown): raw is Entry {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'expires' in raw &&
    typeof raw.expires === 'number' &&
    Number.isFinite(raw.expires) &&
    'value' in raw
  );
}

/** How `chrome.storage` counts an item against its quota: the key plus its JSON. */
function bytesOf(key: string, value: unknown): number {
  return key.length + JSON.stringify(value).length;
}

/**
 * `Cache` with a TTL over the persistent storage, in its own `cache:` key space. It is bounded
 * in entries and bytes (the entries that expire first make room), keeps a reserve of the
 * storage quota free for the wallet's own data, and keeps nothing for more than a day. It
 * never fails: a read or a write that does not work is a miss. Expired entries read as missing.
 */
export class StorageCache implements Cache {
  private readonly limits: Required<StorageCacheOptions>;
  /** What is stored under the prefix; null until read from storage. */
  private stored: Map<string, Stored> | null = null;
  private writesSinceScan = 0;
  /** Writes run one at a time, so the bounds hold under parallel lookups. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: CacheStorage,
    private readonly clock: Pick<Clock, 'now'>,
    options: StorageCacheOptions = {},
  ) {
    this.limits = { ...DEFAULTS, ...options };
  }

  async get(key: string): Promise<unknown> {
    try {
      const raw = await this.storage.get(PREFIX + key);
      if (!isEntry(raw)) return undefined;
      const now = this.clock.now();
      if (raw.expires <= now || raw.expires > now + MAX_TTL_MS) {
        this.stored?.delete(PREFIX + key);
        await this.storage.remove(PREFIX + key);
        return undefined;
      }
      return raw.value;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown, ttlMs: number): Promise<void> {
    const write = this.queue.then(() => this.write(PREFIX + key, value, ttlMs));
    this.queue = write.catch(() => {
      // A write that failed half way leaves the picture unsure: read storage again next time.
      this.stored = null;
    });
    return this.queue;
  }

  private async write(storageKey: string, value: unknown, ttlMs: number): Promise<void> {
    const now = this.clock.now();
    const entry: Entry = { value, expires: now + Math.min(Math.max(ttlMs, 0), MAX_TTL_MS) };
    const bytes = bytesOf(storageKey, entry);
    if (bytes > this.limits.maxBytes) return;

    const stored = await this.load();
    const free = await this.storage.freeBytes();
    const growth = bytes - (stored.get(storageKey)?.bytes ?? 0);
    if (free !== null && free - growth < this.limits.reserveBytes) return;

    // Room first, so the stored entries never go over the bounds, even for a moment.
    stored.delete(storageKey);
    await this.makeRoom(stored, bytes, now);
    await this.storage.set(storageKey, entry);
    stored.set(storageKey, { bytes, expires: entry.expires });
    this.writesSinceScan++;
  }

  private async makeRoom(
    stored: Map<string, Stored>,
    incoming: number,
    now: number,
  ): Promise<void> {
    let total = 0;
    for (const s of stored.values()) total += s.bytes;
    const soonestFirst = [...stored].sort(([, a], [, b]) => a.expires - b.expires);
    for (const [key, s] of soonestFirst) {
      const roomy =
        stored.size < this.limits.maxEntries && total + incoming <= this.limits.maxBytes;
      if (roomy && s.expires > now) break;
      await this.storage.remove(key);
      stored.delete(key);
      total -= s.bytes;
    }
  }

  /** What is stored under the prefix, read again every `RESCAN_EVERY` writes. */
  private async load(): Promise<Map<string, Stored>> {
    if (this.stored !== null && this.writesSinceScan < RESCAN_EVERY) return this.stored;
    const items = await this.storage.entries(PREFIX);
    const stored = new Map<string, Stored>();
    for (const [key, raw] of Object.entries(items)) {
      // Anything unreadable goes first.
      const expires = isEntry(raw) ? raw.expires : Number.NEGATIVE_INFINITY;
      stored.set(key, { bytes: bytesOf(key, raw), expires });
    }
    this.stored = stored;
    this.writesSinceScan = 0;
    return stored;
  }
}
