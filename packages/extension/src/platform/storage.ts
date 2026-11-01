import type { SessionAreaLike, SessionStorage, Storage, StorageAreaLike } from './ports';

/** `Storage` over a `chrome.storage` area (`chrome.storage.local`). */
export class ChromeStorage implements Storage {
  constructor(private readonly area: StorageAreaLike) {}

  async get(key: string): Promise<unknown> {
    const items = await this.area.get(key);
    return Object.hasOwn(items, key) ? items[key] : undefined;
  }

  set(key: string, value: unknown): Promise<void> {
    return this.area.set({ [key]: value });
  }

  remove(key: string): Promise<void> {
    return this.area.remove(key);
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
