import { describe, expect, it } from 'vitest';
import { StorageCache } from './cache';
import { ChromeStorage } from './storage';
import { FakeArea } from './test-support';

function setup() {
  const clock = { t: 1000, now: () => clock.t };
  const area = new FakeArea();
  return { clock, area, cache: new StorageCache(new ChromeStorage(area), clock) };
}

describe('StorageCache', () => {
  it('returns a value until its TTL has passed', async () => {
    const { clock, cache } = setup();
    await cache.set('k', { x: 1 }, 500);
    clock.t = 1499;
    expect(await cache.get('k')).toEqual({ x: 1 });
    clock.t = 1500;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('drops expired entries from storage', async () => {
    const { clock, area, cache } = setup();
    await cache.set('k', 1, 10);
    clock.t = 2000;
    await cache.get('k');
    expect(area.data.size).toBe(0);
  });

  it('treats malformed stored entries as missing', async () => {
    const { area, cache } = setup();
    area.data.set('cache:k', 'garbage');
    expect(await cache.get('k')).toBeUndefined();
  });
});
