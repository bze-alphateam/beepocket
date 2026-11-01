import type { Cache, Clock } from '@beepocket/core';
import type { Storage } from './ports';

interface Entry {
  value: unknown;
  expires: number;
}

const PREFIX = 'cache:';

function isEntry(raw: unknown): raw is Entry {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'expires' in raw &&
    typeof raw.expires === 'number' &&
    'value' in raw
  );
}

/** `Cache` with a TTL over a persistent `Storage`. Expired entries read as missing. */
export class StorageCache implements Cache {
  constructor(
    private readonly storage: Storage,
    private readonly clock: Pick<Clock, 'now'>,
  ) {}

  async get(key: string): Promise<unknown> {
    const raw = await this.storage.get(PREFIX + key);
    if (!isEntry(raw)) return undefined;
    if (raw.expires <= this.clock.now()) {
      await this.storage.remove(PREFIX + key);
      return undefined;
    }
    return raw.value;
  }

  set(key: string, value: unknown, ttlMs: number): Promise<void> {
    const entry: Entry = { value, expires: this.clock.now() + ttlMs };
    return this.storage.set(PREFIX + key, entry);
  }
}
