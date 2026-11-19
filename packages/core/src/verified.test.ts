/* eslint-disable @typescript-eslint/unbound-method -- asserting on vi.fn() stubs */
import { describe, expect, it, vi } from 'vitest';
import { MemoryCache, stubScan } from '../test/stubs';
import { FakeClock, json, MockTransport } from '../test/support';
import {
  BUNDLED_VERIFIED,
  HttpScanClient,
  MAINNET,
  VerifiedRegistry,
  type ScanRegistryEntry,
} from './index';

const ATOM = `ibc/${'5F'.repeat(32)}`;
const GOLD = 'factory/bze1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/gold';
const LIST: ScanRegistryEntry[] = [
  { denom: 'ubze', ticker: 'BZE', verified: true },
  { denom: ATOM, ticker: 'ATOM', verified: true },
  { denom: GOLD, ticker: 'GOLD', verified: false },
];
const BUNDLED = [{ denom: 'factory/bze1x/old', symbol: 'OLD' }];

describe('HttpScanClient.assets', () => {
  it("reads the whole registry list with each asset's verified flag", async () => {
    const t = new MockTransport(MAINNET.scan).on(
      'GET',
      '/api/v1/registry/assets',
      json(200, {
        version: 'v1',
        assets: [
          { denom: 'ubze', ticker: 'BZE', name: 'BeeZee', verified: true, routes: [] },
          { denom: GOLD, ticker: 'GOLD', name: 'Gold', verified: false },
          // Scan versions without the flag list nothing as verified.
          { denom: ATOM, ticker: 'ATOM', name: 'Cosmos Hub' },
        ],
      }),
    );
    expect(await new HttpScanClient(t, MAINNET).assets()).toEqual([
      { denom: 'ubze', ticker: 'BZE', verified: true },
      { denom: GOLD, ticker: 'GOLD', verified: false },
      { denom: ATOM, ticker: 'ATOM', verified: false },
    ]);
  });
});

describe('VerifiedRegistry', () => {
  function setup(assets: ScanRegistryEntry[] | Error = LIST) {
    const scan = stubScan({
      assets: vi.fn(() =>
        assets instanceof Error ? Promise.reject(assets) : Promise.resolve(assets),
      ),
    });
    const cache = new MemoryCache();
    const clock = new FakeClock();
    const registry = () =>
      new VerifiedRegistry(scan, { cache, cacheKeyPrefix: 'test:', bundled: BUNDLED, clock });
    return { scan, cache, clock, registry };
  }

  it("keeps only Scan's verified assets, with their tickers", async () => {
    const { registry } = setup();
    expect(await registry().list()).toEqual([
      { denom: 'ubze', symbol: 'BZE' },
      { denom: ATOM, symbol: 'ATOM' },
    ]);
  });

  it('asks Scan once and answers later lookups from the cache', async () => {
    const { scan, registry } = setup();
    const r = registry();
    await Promise.all([r.list(), r.list()]);
    await registry().list();
    expect(scan.assets).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last cached list when Scan cannot answer', async () => {
    const t = setup();
    await t.registry().list();
    // Past the refresh interval, Scan is asked again and is down.
    await t.clock.sleep(2 * 60 * 60 * 1000);
    vi.mocked(t.scan.assets).mockRejectedValue(new Error('down'));
    expect(await t.registry().list()).toEqual([
      { denom: 'ubze', symbol: 'BZE' },
      { denom: ATOM, symbol: 'ATOM' },
    ]);
    expect(t.scan.assets).toHaveBeenCalledTimes(2);
  });

  it('falls back to the bundled list when Scan cannot answer and nothing is cached', async () => {
    const { registry } = setup(new Error('down'));
    expect(await registry().list()).toEqual(BUNDLED);
  });

  it('treats an empty verified list from Scan as no answer and does not keep it', async () => {
    const t = setup();
    await t.registry().list();
    await t.clock.sleep(2 * 60 * 60 * 1000);
    vi.mocked(t.scan.assets).mockResolvedValue([{ denom: GOLD, ticker: 'GOLD', verified: false }]);
    expect(await t.registry().list()).toEqual([
      { denom: 'ubze', symbol: 'BZE' },
      { denom: ATOM, symbol: 'ATOM' },
    ]);
    // The last good list is still the one cached.
    vi.mocked(t.scan.assets).mockRejectedValue(new Error('down'));
    await t.clock.sleep(2 * 60 * 1000);
    expect(await t.registry().list()).toEqual([
      { denom: 'ubze', symbol: 'BZE' },
      { denom: ATOM, symbol: 'ATOM' },
    ]);
  });

  it('falls back to the bundled list when Scan answers with an empty list', async () => {
    const { registry, cache } = setup([]);
    expect(await registry().list()).toEqual(BUNDLED);
    expect(await cache.get('test:verified')).toBeUndefined();
  });

  it('does not wait on a Scan that never answers', async () => {
    const scan = stubScan({ assets: vi.fn(() => new Promise<never>(() => undefined)) });
    const registry = new VerifiedRegistry(scan, { bundled: BUNDLED, clock: new FakeClock() });
    expect(await registry.list()).toEqual(BUNDLED);
  });

  it('ships a bundled list per network; testnet verifies only the native coin', () => {
    expect(BUNDLED_VERIFIED.testnet).toEqual([]);
    expect(BUNDLED_VERIFIED.mainnet.map((a) => a.symbol)).toContain('ATOM');
    expect(BUNDLED_VERIFIED.mainnet.some((a) => a.denom === 'ubze')).toBe(false);
  });
});
