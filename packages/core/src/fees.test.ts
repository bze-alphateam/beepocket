/* eslint-disable @typescript-eslint/unbound-method -- asserting on vi.fn() stubs */
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../test/support';
import { MemoryCache, stubChain } from '../test/stubs';
import {
  FEE_TTL_MS,
  FeeEstimator,
  SimulationError,
  UnexpectedResponseError,
  simulationTxBytes,
  type ChainClient,
  type Pool,
} from './index';

const X = 'factory/bze1abc/ux';
const Y = 'factory/bze1abc/uy';
const NATIVE = 'ubze';
const MIN_LIQUIDITY = 100_000_000_000n;

const body = new Uint8Array([1, 2, 3]);
const pubKey = new Uint8Array(33).fill(2);

function pool(
  base: string,
  quote: string,
  reserveBase: bigint,
  reserveQuote: bigint,
  extra: Partial<Pool> = {},
): Pool {
  return { id: `${base}:${quote}`, base, quote, reserveBase, reserveQuote, ...extra };
}

/** Native 1,000,000,000,000 against 500,000,000,000 of X: spot 2 BZE per X. */
const deepPool = pool(NATIVE, X, 1_000_000_000_000n, 500_000_000_000n);

function chainWith(
  pools: Pool[],
  options: { halted?: string[]; gasUsed?: bigint; gasPrice?: string } = {},
): ChainClient {
  return stubChain({
    feeParams: vi.fn().mockResolvedValue({
      minGasPrice: { denom: NATIVE, amount: options.gasPrice ?? '0.010000000000000000' },
    }),
    tradebinParams: vi.fn().mockResolvedValue({
      nativeDenom: NATIVE,
      minNativeLiquidityForModuleSwap: MIN_LIQUIDITY,
    }),
    liquidityPools: vi.fn().mockResolvedValue(pools),
    haltedDenoms: vi.fn().mockResolvedValue(options.halted ?? []),
    simulate: vi.fn().mockResolvedValue({ gasUsed: options.gasUsed ?? 153_846n }),
  });
}

function estimator(chain: ChainClient, extra = {}) {
  return new FeeEstimator(chain, new FakeClock(), extra);
}

function estimate(fees: FeeEstimator, balances: [string, bigint][], preferred?: string) {
  return fees.estimate({
    bodyBytes: body,
    pubKey,
    sequence: 7n,
    balances: new Map(balances),
    ...(preferred === undefined ? {} : { preferred }),
  });
}

describe('FeeEstimator.feeTokenRates', () => {
  it('gives the native denom the validator minimum as an exact fraction', async () => {
    const rates = await estimator(chainWith([])).feeTokenRates();
    expect([...rates.keys()]).toEqual([NATIVE]);
    expect(rates.get(NATIVE)).toEqual({ num: 10_000_000_000_000_000n, den: 10n ** 18n });
  });

  it('prices a token from its pool with 5% headroom', async () => {
    const rates = await estimator(chainWith([deepPool])).feeTokenRates();
    // 0.01 BZE/gas ÷ 2 BZE per X × 1.05 = 0.00525 X/gas
    const rate = rates.get(X);
    expect(rate).toBeDefined();
    expect(rate && (rate.num * 100_000_000n) / rate.den).toBe(525_000n);
  });

  it('is eligible at exactly the liquidity threshold and not one below', async () => {
    const at = pool(NATIVE, X, MIN_LIQUIDITY, 50_000_000_000n);
    const below = pool(NATIVE, Y, MIN_LIQUIDITY - 1n, 50_000_000_000n);
    const rates = await estimator(chainWith([at, below])).feeTokenRates();
    expect(rates.has(X)).toBe(true);
    expect(rates.has(Y)).toBe(false);
  });

  it('reads a pool with the token as base and with the token as quote', async () => {
    const asQuote = pool(NATIVE, X, 1_000_000_000_000n, 500_000_000_000n);
    const asBase = pool(Y, NATIVE, 500_000_000_000n, 1_000_000_000_000n);
    const rates = await estimator(chainWith([asQuote, asBase])).feeTokenRates();
    expect(rates.get(Y)).toEqual(rates.get(X));
  });

  it('leaves out halted tokens, halted pools, missing pools and pools between two tokens', async () => {
    const rates = await estimator(
      chainWith(
        [
          deepPool,
          pool(NATIVE, Y, 1_000_000_000_000n, 500_000_000_000n, { halted: true }),
          pool('factory/bze1abc/uz', X, 1_000_000_000_000n, 1_000_000_000_000n),
        ],
        { halted: [X] },
      ),
    ).feeTokenRates();
    expect([...rates.keys()]).toEqual([NATIVE]);
  });

  it.each([
    ['token', pool(NATIVE, X, 1_000_000_000_000n, 0n)],
    ['native', pool(NATIVE, X, 0n, 500_000_000_000n)],
  ])('ignores a pool with an empty %s reserve', async (_, empty) => {
    const rates = await estimator(chainWith([empty])).feeTokenRates();
    expect(rates.has(X)).toBe(false);
  });

  it('does not divide by zero when the chain threshold is zero and the pool is empty', async () => {
    const chain = chainWith([pool(NATIVE, X, 0n, 0n)]);
    vi.mocked(chain.tradebinParams).mockResolvedValue({
      nativeDenom: NATIVE,
      minNativeLiquidityForModuleSwap: 0n,
    });
    expect((await estimator(chain).feeTokenRates()).has(X)).toBe(false);
  });

  it('keeps the first pool of a pair', async () => {
    const first = deepPool;
    const second = pool(NATIVE, X, 2_000_000_000_000n, 500_000_000_000n);
    const [a, b] = await Promise.all([
      estimator(chainWith([first, second])).feeTokenRates(),
      estimator(chainWith([first])).feeTokenRates(),
    ]);
    expect(a.get(X)).toEqual(b.get(X));
  });

  it('refuses a gas price that is not in the native denom', async () => {
    const chain = chainWith([]);
    vi.mocked(chain.feeParams).mockResolvedValue({ minGasPrice: { denom: 'uother', amount: '1' } });
    await expect(estimator(chain).feeTokenRates()).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it('refuses an absurdly long gas price', async () => {
    const chain = chainWith([], { gasPrice: `0.${'1'.repeat(60)}` });
    await expect(estimator(chain).feeTokenRates()).rejects.toBeInstanceOf(UnexpectedResponseError);
  });
});

describe('FeeEstimator.estimate', () => {
  it('prices BZE: gas 153,846 gives limit 200,000 and a fee of 2,000 ubze', async () => {
    const chain = chainWith([]);
    const result = await estimate(estimator(chain), [[NATIVE, 5_000n]]);
    expect(result).toEqual({
      gasLimit: 200_000n,
      options: [{ denom: NATIVE, amount: 2_000n }],
      default: NATIVE,
    });
    expect(chain.simulate).toHaveBeenCalledWith(simulationTxBytes(body, pubKey, 7n));
  });

  it('prices token X: 1,050 uX at gas limit 200,000', async () => {
    const result = await estimate(estimator(chainWith([deepPool])), [[X, 10_000n]]);
    expect(result.options).toEqual([{ denom: X, amount: 1_050n }]);
    expect(result.default).toBe(X);
  });

  it('offers nothing when the payer holds one unit less than the fee', async () => {
    const result = await estimate(estimator(chainWith([deepPool])), [[X, 1_049n]]);
    expect(result).toEqual({ gasLimit: 200_000n, options: [], default: null });
  });

  it('offers a token that is held exactly', async () => {
    const result = await estimate(estimator(chainWith([deepPool])), [[X, 1_050n]]);
    expect(result.default).toBe(X);
  });

  it('does not offer a token below the liquidity threshold or a halted one', async () => {
    const thin = pool(NATIVE, X, MIN_LIQUIDITY - 1n, 50_000_000_000n);
    const thinResult = await estimate(estimator(chainWith([thin])), [[X, 10n ** 12n]]);
    expect(thinResult.options).toEqual([]);
    const haltedResult = await estimate(estimator(chainWith([deepPool], { halted: [X] })), [
      [X, 10n ** 12n],
    ]);
    expect(haltedResult.options).toEqual([]);
  });

  it('rounds the gas limit and every fee up', async () => {
    // 1 gas used -> limit ceil(1.3) = 2; 0.01 × 2 = 0.02 -> 1 ubze
    const small = await estimate(estimator(chainWith([], { gasUsed: 1n })), [[NATIVE, 5n]]);
    expect(small).toMatchObject({ gasLimit: 2n, options: [{ denom: NATIVE, amount: 1n }] });
    // exact multiple does not round up: 10 gas -> 13
    const exact = await estimate(estimator(chainWith([], { gasUsed: 10n })), [[NATIVE, 5n]]);
    expect(exact.gasLimit).toBe(13n);
    // a price that does not divide evenly: 0.01 × 1.05 / 2 ... gas 1 -> limit 2, X fee < 1 -> 1
    const token = await estimate(estimator(chainWith([deepPool], { gasUsed: 1n })), [[X, 5n]]);
    expect(token.options).toEqual([{ denom: X, amount: 1n }]);
  });

  it('puts BZE first and makes it the default when the payer holds it', async () => {
    const result = await estimate(estimator(chainWith([deepPool])), [
      [X, 10_000n],
      [NATIVE, 10_000n],
    ]);
    expect(result.options.map((o) => o.denom)).toEqual([NATIVE, X]);
    expect(result.default).toBe(NATIVE);
  });

  it('defaults to the preferred token when BZE is not affordable', async () => {
    const pools = [deepPool, pool(NATIVE, Y, 1_000_000_000_000n, 500_000_000_000n)];
    const chain = chainWith(pools);
    expect(
      (
        await estimate(
          estimator(chain),
          [
            [X, 9_999n],
            [Y, 9_999n],
            [NATIVE, 1n],
          ],
          Y,
        )
      ).default,
    ).toBe(Y);
    // preferred but not affordable -> first option
    expect(
      (
        await estimate(
          estimator(chain),
          [
            [X, 9_999n],
            [Y, 1n],
          ],
          Y,
        )
      ).default,
    ).toBe(X);
    // preferred but not eligible at all -> first option
    expect((await estimate(estimator(chain), [[X, 9_999n]], 'factory/bze1abc/unone')).default).toBe(
      X,
    );
  });

  it('orders the other options by symbol, then denom, when a symbol source is given', async () => {
    const tokens = {
      resolve: vi.fn((denom: string) =>
        denom === 'factory/bze1abc/uz'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ symbol: denom === X ? 'ZED' : 'ALPHA' }),
      ),
    };
    const pools = [
      deepPool,
      pool(NATIVE, Y, 1_000_000_000_000n, 500_000_000_000n),
      pool(NATIVE, 'factory/bze1abc/uz', 1_000_000_000_000n, 500_000_000_000n),
    ];
    const result = await estimate(estimator(chainWith(pools), { tokens }), [
      [X, 10_000n],
      [Y, 10_000n],
      ['factory/bze1abc/uz', 10_000n],
      [NATIVE, 10_000n],
    ]);
    // 'factory/bze1abc/uz' falls back to its denom as the sort key, which sorts after ALPHA and ZED
    expect(result.options.map((o) => o.denom)).toEqual([NATIVE, Y, X, 'factory/bze1abc/uz']);
  });

  it('orders by denom without a symbol source', async () => {
    const pools = [deepPool, pool(NATIVE, Y, 1_000_000_000_000n, 500_000_000_000n)];
    const result = await estimate(estimator(chainWith(pools)), [
      [Y, 10_000n],
      [X, 10_000n],
    ]);
    expect(result.options.map((o) => o.denom)).toEqual([X, Y]);
  });

  it('handles amounts beyond 2^64 exactly', async () => {
    const huge = 10n ** 30n;
    const result = await estimate(
      estimator(chainWith([pool(NATIVE, X, huge * 2n, huge)], { gasUsed: 10n ** 24n })),
      [[X, huge]],
    );
    // limit = 1.3e24, fee = 1.3e24 × 0.01 × 1/2 × 1.05 = 6.825e21
    expect(result.gasLimit).toBe(1_300_000_000_000_000_000_000_000n);
    expect(result.options).toEqual([{ denom: X, amount: 6_825_000_000_000_000_000_000n }]);
  });

  it('passes simulation errors through', async () => {
    const chain = chainWith([]);
    vi.mocked(chain.simulate).mockRejectedValue(new SimulationError('insufficient funds', 400));
    await expect(estimate(estimator(chain), [[NATIVE, 1n]])).rejects.toMatchObject({
      name: 'SimulationError',
      message: 'insufficient funds',
    });
  });
});

describe('FeeEstimator cache', () => {
  it('stores the rates for five minutes and serves them without the chain', async () => {
    const chain = chainWith([deepPool]);
    const cache = new MemoryCache();
    const fees = estimator(chain, { cache });
    const first = await fees.feeTokenRates();
    expect(cache.ttls.get('fees:rates')).toBe(FEE_TTL_MS);
    expect(await fees.feeTokenRates()).toEqual(first);
    expect(chain.liquidityPools).toHaveBeenCalledTimes(1);
  });

  it('shares nothing between key prefixes', async () => {
    const chain = chainWith([]);
    const cache = new MemoryCache();
    await estimator(chain, { cache, cacheKeyPrefix: 'test:' }).feeTokenRates();
    await estimator(chain, { cache }).feeTokenRates();
    expect(chain.feeParams).toHaveBeenCalledTimes(2);
  });

  it('refetches when the store hands back an old entry', async () => {
    const chain = chainWith([deepPool]);
    const cache = new MemoryCache();
    const clock = new FakeClock();
    const fees = new FeeEstimator(chain, clock, { cache });
    await fees.feeTokenRates();
    await clock.sleep(FEE_TTL_MS);
    await fees.feeTokenRates();
    expect(chain.feeParams).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['junk', 'oops'],
    [
      'an entry from the future',
      { fetchedAt: 9e15, nativeDenom: NATIVE, rates: [[NATIVE, '1', '100']] },
    ],
    [
      'a zero denominator',
      { fetchedAt: 1_000_000, nativeDenom: NATIVE, rates: [[NATIVE, '1', '0']] },
    ],
    [
      'a negative numerator',
      { fetchedAt: 1_000_000, nativeDenom: NATIVE, rates: [[NATIVE, '-1', '1']] },
    ],
    ['no native rate', { fetchedAt: 1_000_000, nativeDenom: NATIVE, rates: [] }],
    ['a malformed row', { fetchedAt: 1_000_000, nativeDenom: NATIVE, rates: [[NATIVE]] }],
  ])('ignores a cache entry that is %s', async (_, entry) => {
    const chain = chainWith([]);
    const cache = new MemoryCache();
    cache.store.set('fees:rates', entry);
    const rates = await estimator(chain, { cache }).feeTokenRates();
    expect(rates.has(NATIVE)).toBe(true);
    expect(chain.feeParams).toHaveBeenCalledTimes(1);
  });
});
