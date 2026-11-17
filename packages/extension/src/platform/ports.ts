/**
 * Persistent key/value store. Values must be JSON-serialisable. The service worker may be
 * stopped at any time, so anything that has to survive lives here (or in `SessionStorage`).
 */
export interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /** Writes several keys in one call: all of them land or none does. */
  setMany(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Store that survives a service-worker restart but not a browser restart. */
export type SessionStorage = Storage;

/** A `Storage` that can also list its keys and tell how much room is left, for the cache. */
export interface CacheStorage extends Storage {
  /** Every stored item whose key starts with `prefix`. */
  entries(prefix: string): Promise<Record<string, unknown>>;
  /** Bytes still free under the area's quota; null when the browser cannot tell. */
  freeBytes(): Promise<number | null>;
}

/** The slice of a `chrome.storage` area the adapters use. */
export interface StorageAreaLike {
  /** `null` reads every item. */
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
  /** Missing on browsers without it. */
  getBytesInUse?(keys: null): Promise<number>;
  /** The area's quota; missing on areas and browsers without one. */
  readonly QUOTA_BYTES?: number | undefined;
}

export interface SessionAreaLike extends StorageAreaLike {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

/** `chrome.storage.local`: older browsers cannot restrict its access level. */
export interface LocalAreaLike extends StorageAreaLike {
  setAccessLevel?: ((options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>) | undefined;
}
