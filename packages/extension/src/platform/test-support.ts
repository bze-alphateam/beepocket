import type { SessionAreaLike } from './ports';

/** In-memory stand-in for a `chrome.storage` area, shared by the platform tests. */
export class FakeArea implements SessionAreaLike {
  readonly data = new Map<string, unknown>();
  readonly accessLevels: string[] = [];

  get(keys: string): Promise<Record<string, unknown>> {
    return Promise.resolve(this.data.has(keys) ? { [keys]: this.data.get(keys) } : {});
  }

  set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.data.set(k, v);
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
}
