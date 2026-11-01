import { describe, expect, it } from 'vitest';
import { ChromeSessionStorage, ChromeStorage } from './storage';
import { FakeArea } from './test-support';

describe('ChromeStorage', () => {
  it('stores, reads and removes values', async () => {
    const storage = new ChromeStorage(new FakeArea());
    expect(await storage.get('k')).toBeUndefined();
    await storage.set('k', { a: 1 });
    expect(await storage.get('k')).toEqual({ a: 1 });
    await storage.setMany({ a: 1, b: 2 });
    expect([await storage.get('a'), await storage.get('b')]).toEqual([1, 2]);
    await storage.remove('k');
    expect(await storage.get('k')).toBeUndefined();
  });
});

describe('ChromeSessionStorage', () => {
  it('restricts the access level to trusted contexts exactly once, on open', async () => {
    const area = new FakeArea();
    const session = await ChromeSessionStorage.open(area);
    await session.set('k', 1);
    await session.get('k');
    expect(area.accessLevels).toEqual(['TRUSTED_CONTEXTS']);
    expect(await session.get('k')).toBe(1);
  });
});
