import { vi } from 'vitest';
import type { Cache, ChainClient, ScanClient } from '../src/index';

function notStubbed(name: string): () => never {
  return () => {
    throw new Error(`${name} was not stubbed`);
  };
}

/** A `ChainClient` whose methods all throw unless the test supplies them. */
export function stubChain(overrides: Partial<ChainClient> = {}): ChainClient {
  return {
    account: vi.fn(notStubbed('account')),
    balances: vi.fn(notStubbed('balances')),
    supply: vi.fn(notStubbed('supply')),
    denomMetadata: vi.fn(notStubbed('denomMetadata')),
    denomBranding: vi.fn(notStubbed('denomBranding')),
    feeParams: vi.fn(notStubbed('feeParams')),
    tradebinParams: vi.fn(notStubbed('tradebinParams')),
    liquidityPools: vi.fn(notStubbed('liquidityPools')),
    haltedDenoms: vi.fn(notStubbed('haltedDenoms')),
    markets: vi.fn(notStubbed('markets')),
    marketOrder: vi.fn(notStubbed('marketOrder')),
    simulate: vi.fn(notStubbed('simulate')),
    broadcast: vi.fn(notStubbed('broadcast')),
    waitForTx: vi.fn(notStubbed('waitForTx')),
    ...overrides,
  };
}

export function stubScan(overrides: Partial<ScanClient> = {}): ScanClient {
  return {
    token: vi.fn(notStubbed('token')),
    activity: vi.fn(notStubbed('activity')),
    ...overrides,
  };
}

/** An in-memory `Cache` that records TTLs and does not expire anything itself. */
export class MemoryCache implements Cache {
  readonly store = new Map<string, unknown>();
  readonly ttls = new Map<string, number>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.store.get(key));
  }

  set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.store.set(key, value);
    this.ttls.set(key, ttlMs);
    return Promise.resolve();
  }
}
