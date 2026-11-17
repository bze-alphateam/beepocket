import type {
  CacheStorage,
  LocalAreaLike,
  SessionAreaLike,
  SessionStorage,
  StorageAreaLike,
} from './ports';

/** `Storage` over a `chrome.storage` area (`chrome.storage.local`). */
export class ChromeStorage implements CacheStorage {
  constructor(private readonly area: StorageAreaLike) {}

  async get(key: string): Promise<unknown> {
    const items = await this.area.get(key);
    return Object.hasOwn(items, key) ? items[key] : undefined;
  }

  set(key: string, value: unknown): Promise<void> {
    return this.area.set({ [key]: value });
  }

  setMany(items: Record<string, unknown>): Promise<void> {
    return this.area.set(items);
  }

  remove(key: string): Promise<void> {
    return this.area.remove(key);
  }

  async entries(prefix: string): Promise<Record<string, unknown>> {
    const items = await this.area.get(null);
    return Object.fromEntries(Object.entries(items).filter(([key]) => key.startsWith(prefix)));
  }

  async freeBytes(): Promise<number | null> {
    const quota = this.area.QUOTA_BYTES;
    if (typeof quota !== 'number' || typeof this.area.getBytesInUse !== 'function') return null;
    try {
      return quota - (await this.area.getBytesInUse(null));
    } catch {
      return null;
    }
  }
}

/**
 * `ChromeStorage` over `chrome.storage.local`. Content scripts have no business with wallet
 * data, so the access level is restricted to trusted contexts on open, where the browser
 * supports it. A browser without it keeps its default, and the wallet still works.
 */
export class ChromeLocalStorage extends ChromeStorage {
  private constructor(area: LocalAreaLike) {
    super(area);
  }

  static async open(area: LocalAreaLike): Promise<ChromeLocalStorage> {
    if (typeof area.setAccessLevel === 'function') {
      try {
        await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      } catch {
        // Not supported for this area here: the default access level stays.
      }
    }
    return new ChromeLocalStorage(area);
  }
}

/**
 * `SessionStorage` over `chrome.storage.session`. Content scripts must never read it, so the
 * access level is restricted to trusted contexts once, before the first use.
 */
export class ChromeSessionStorage extends ChromeStorage implements SessionStorage {
  private constructor(area: SessionAreaLike) {
    super(area);
  }

  static async open(area: SessionAreaLike): Promise<ChromeSessionStorage> {
    await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    return new ChromeSessionStorage(area);
  }
}
