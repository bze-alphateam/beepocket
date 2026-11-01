/**
 * Optional key/value store the extension can pass to the resolvers. `core` never
 * caches on its own; a persistent store may ignore `ttlMs`, so readers re-check
 * what they read.
 */
export interface Cache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

/** How long token data may be reused. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** How long fee data (gas price, pools, halted denoms) may be reused. */
export const FEE_TTL_MS = 5 * 60 * 1000;
