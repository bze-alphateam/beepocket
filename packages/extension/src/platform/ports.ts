/**
 * Persistent key/value store. Values must be JSON-serialisable. The service worker may be
 * stopped at any time, so anything that has to survive lives here (or in `SessionStorage`).
 */
export interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Store that survives a service-worker restart but not a browser restart. */
export type SessionStorage = Storage;

/** The slice of a `chrome.storage` area the adapters use. */
export interface StorageAreaLike {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
}

export interface SessionAreaLike extends StorageAreaLike {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}
