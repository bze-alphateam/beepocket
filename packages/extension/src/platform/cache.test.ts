import { describe, expect, it } from 'vitest';
import { StorageCache, type StorageCacheOptions } from './cache';
import { ChromeStorage } from './storage';
import { FakeArea, type FakeAreaOptions } from './test-support';

const DAY_MS = 24 * 60 * 60 * 1000;

function setup(options: StorageCacheOptions = {}, area = new FakeArea()) {
  const clock = { t: 1000, now: () => clock.t };
  return { clock, area, cache: new StorageCache(new ChromeStorage(area), clock, options) };
}

const cacheKeys = (area: FakeArea) => [...area.data.keys()].filter((k) => k.startsWith('cache:'));

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

  it('keeps at most the entry limit, dropping the entries that expire first', async () => {
    const { clock, area, cache } = setup({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) {
      clock.t += 1;
      await cache.set(`k${String(i)}`, i, 60_000);
    }
    expect(cacheKeys(area).sort()).toEqual(['cache:k7', 'cache:k8', 'cache:k9']);
    expect(await cache.get('k9')).toBe(9);
    expect(await cache.get('k0')).toBeUndefined();
  });

  it('keeps the stored entries under the byte limit', async () => {
    const { area, cache } = setup({ maxBytes: 2_000 });
    for (let i = 0; i < 50; i++) await cache.set(`k${String(i)}`, 'x'.repeat(100), 60_000);
    expect(area.bytes()).toBeLessThanOrEqual(2_000);
    expect(cacheKeys(area).length).toBeGreaterThan(0);
  });

  it('does not store an entry larger than the byte limit', async () => {
    const { area, cache } = setup({ maxBytes: 500 });
    await cache.set('big', 'x'.repeat(1_000), 60_000);
    expect(area.data.size).toBe(0);
    expect(await cache.get('big')).toBeUndefined();
  });

  it('counts what other instances stored before it', async () => {
    const area = new FakeArea();
    const clock = { now: () => 1000 };
    const a = new StorageCache(new ChromeStorage(area), clock, { maxEntries: 5 });
    for (let i = 0; i < 5; i++) await a.set(`a${String(i)}`, i, 60_000);
    const b = new StorageCache(new ChromeStorage(area), clock, { maxEntries: 5 });
    for (let i = 0; i < 5; i++) await b.set(`b${String(i)}`, i, 60_000);
    expect(cacheKeys(area)).toHaveLength(5);
  });

  it('stays bounded under many writes at once', async () => {
    const { area, cache } = setup({ maxEntries: 4 });
    await Promise.all(Array.from({ length: 40 }, (_, i) => cache.set(`k${String(i)}`, i, 60_000)));
    expect(cacheKeys(area)).toHaveLength(4);
  });

  it('leaves other keys alone when it makes room', async () => {
    const { area, cache } = setup({ maxEntries: 2 });
    area.data.set('vault', { v: 1 });
    area.data.set('profile', { p: 1 });
    for (let i = 0; i < 5; i++) await cache.set(`k${String(i)}`, i, 60_000);
    expect(area.data.get('vault')).toEqual({ v: 1 });
    expect(area.data.get('profile')).toEqual({ p: 1 });
  });

  it.each<[string, FakeAreaOptions]>([
    ['a refused write', { failingKeys: ['cache:k'] }],
    ['a full storage', { quotaBytes: 10 }],
  ])('reads %s as a miss and never rejects', async (_, areaOptions) => {
    const { cache } = setup({}, new FakeArea(areaOptions));
    await expect(cache.set('k', { x: 1 }, 60_000)).resolves.toBeUndefined();
    expect(await cache.get('k')).toBeUndefined();
  });

  it('reads a storage failure as a miss', async () => {
    const area = new FakeArea();
    area.get = () => Promise.reject(new Error('read failed'));
    const { cache } = setup({}, area);
    expect(await cache.get('k')).toBeUndefined();
    await expect(cache.set('k', 1, 60_000)).resolves.toBeUndefined();
  });

  it('keeps room free for the wallet data', async () => {
    const area = new FakeArea({ quotaBytes: 4_000 });
    area.data.set('profile', 'p'.repeat(2_500));
    const { cache } = setup({ reserveBytes: 1_500 }, area);
    await cache.set('k', 'x'.repeat(100), 60_000);
    expect(cacheKeys(area)).toEqual([]);
    // The wallet can still write: the cache never ate into the reserve.
    await area.set({ throttle: { failures: 1, lockedUntil: 0 } });
  });

  it('clears older entries to get back above the reserve, then stores', async () => {
    const area = new FakeArea({ quotaBytes: 6_000 });
    area.data.set('profile', 'p'.repeat(1_000));
    // Entries an earlier build left behind, filling the room the wallet needs.
    for (let i = 0; i < 20; i++) {
      area.data.set(`cache:old${String(i)}`, { value: 'x'.repeat(150), expires: 2_000 + i });
    }
    const { cache } = setup({ reserveBytes: 2_000 }, area);
    await cache.set('k', 1, 60_000);
    expect(6_000 - area.bytes()).toBeGreaterThanOrEqual(2_000);
    expect(await cache.get('k')).toBe(1);
    expect(area.data.get('profile')).toBe('p'.repeat(1_000));
  });

  it('clears its entries even when the reserve cannot be reached, and stores nothing', async () => {
    const area = new FakeArea({ quotaBytes: 4_000 });
    area.data.set('profile', 'p'.repeat(2_500));
    for (let i = 0; i < 5; i++)
      area.data.set(`cache:old${String(i)}`, { value: 1, expires: 5_000 });
    const { cache } = setup({ reserveBytes: 2_000 }, area);
    await cache.set('k', 1, 60_000);
    expect(cacheKeys(area)).toEqual([]);
  });

  it('brings entries left over the limits back within them on the next write', async () => {
    const { area, cache } = setup({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) {
      area.data.set(`cache:old${String(i)}`, { value: i, expires: 50_000 + i });
    }
    await cache.set('k', 1, 60_000);
    expect(cacheKeys(area)).toHaveLength(3);
    expect(await cache.get('k')).toBe(1);
  });

  it('reads an entry that claims to last longer than a day as missing', async () => {
    const { clock, area, cache } = setup();
    area.data.set('cache:k', { value: 1, expires: clock.t + DAY_MS + 1 });
    expect(await cache.get('k')).toBeUndefined();
    area.data.set('cache:n', { value: 1, expires: Number.POSITIVE_INFINITY });
    expect(await cache.get('n')).toBeUndefined();
  });

  it('keeps nothing for more than a day, whatever TTL it is given', async () => {
    const { clock, cache } = setup();
    await cache.set('k', 1, 365 * DAY_MS);
    clock.t += DAY_MS - 1;
    expect(await cache.get('k')).toBe(1);
    clock.t += 1;
    expect(await cache.get('k')).toBeUndefined();
  });
});
