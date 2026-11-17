import type { SessionAreaLike } from './ports';

/** How `chrome.storage` counts a stored item against its quota: the key plus its JSON. */
export function itemBytes(key: string, value: unknown): number {
  return key.length + JSON.stringify(value).length;
}

export interface FakeAreaOptions {
  /** Like `chrome.storage.local`: a write that would pass this many bytes is refused whole. */
  quotaBytes?: number;
  /** Keys whose writes are refused, as a full or failing storage would. */
  failingKeys?: string[];
}

/** In-memory stand-in for a `chrome.storage` area, shared by the platform tests. */
export class FakeArea implements SessionAreaLike {
  readonly data = new Map<string, unknown>();
  readonly accessLevels: string[] = [];
  readonly failingKeys: Set<string>;
  readonly quotaBytes: number | undefined;

  constructor(options: FakeAreaOptions = {}) {
    this.quotaBytes = options.quotaBytes;
    this.failingKeys = new Set(options.failingKeys ?? []);
  }

  get(keys: string | null): Promise<Record<string, unknown>> {
    if (keys === null) return Promise.resolve(Object.fromEntries(this.data));
    return Promise.resolve(this.data.has(keys) ? { [keys]: this.data.get(keys) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(items);
    if (entries.some(([k]) => this.failingKeys.has(k))) {
      return Promise.reject(new Error('write refused'));
    }
    if (this.quotaBytes !== undefined) {
      const next = new Map(this.data);
      for (const [k, v] of entries) next.set(k, v);
      if (this.bytesOf(next) > this.quotaBytes) {
        return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
      }
    }
    for (const [k, v] of entries) this.data.set(k, v);
    return Promise.resolve();
  }

  remove(keys: string): Promise<void> {
    this.data.delete(keys);
    return Promise.resolve();
  }

  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void> {
    this.accessLevels.push(options.accessLevel);
    return Promise.resolve();
  }

  /** `chrome.storage.local.QUOTA_BYTES`; only an area with a quota has one. */
  get QUOTA_BYTES(): number | undefined {
    return this.quotaBytes;
  }

  getBytesInUse(keys: null): Promise<number> {
    void keys;
    return Promise.resolve(this.bytes());
  }

  /** Bytes in use, counted the way `chrome.storage` does. */
  bytes(): number {
    return this.bytesOf(this.data);
  }

  private bytesOf(data: Map<string, unknown>): number {
    let total = 0;
    for (const [k, v] of data) total += itemBytes(k, v);
    return total;
  }
}
