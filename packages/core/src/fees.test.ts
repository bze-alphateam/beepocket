/* eslint-disable @typescript-eslint/unbound-method -- asserting on vi.fn() stubs */
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../test/support';
import { MemoryCache, stubChain } from '../test/stubs';
import {
  FEE_TTL_MS,
  FeeEstimator,
  GAS_PRICE_MULTIPLIERS,
  feeAt,
  feePricing,
  gasLimitBounds,
  isGasPriceMultiplier,
  minimumFee,
  priceGasOverride,
  quickGasLimits,
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
    simulate: vi.fn().mockResolvedValue({ gasUsed: options.gasUsed ?? 200_000n }),
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

  it('prices a token from its pool at the spot ratio, with no margin', async () => {
    const rates = await estimator(chainWith([deepPool])).feeTokenRates();
    // 0.01 BZE/gas ÷ 2 BZE per X = 0.005 X/gas
    const rate = rates.get(X);
    expect(rate).toBeDefined();
    expect(rate && (rate.num * 100_000_000n) / rate.den).toBe(500_000n);
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

  const ineligible: [string, Pool][] = [
    ['empty', pool(NATIVE, X, 1_000_000_000_000n, 0n)],
    ['halted', pool(NATIVE, X, 1_000_000_000_000n, 500_000_000_000n, { halted: true })],
    ['too thin', pool(NATIVE, X, MIN_LIQUIDITY - 1n, 500_000_000_000n)],
  ];

  it.each(ineligible)(
    'an %s first pool does not shadow an eligible second pool',
    async (_, bad) => {
      const rates = await estimator(chainWith([bad, deepPool])).feeTokenRates();
      expect(rates.get(X)).toEqual((await estimator(chainWith([deepPool])).feeTokenRates()).get(X));
    },
  );

  it('never uses an ineligible pool, even when every pool of the pair is ineligible', async () => {
    const rates = await estimator(chainWith(ineligible.map(([, p]) => p))).feeTokenRates();
    expect(rates.has(X)).toBe(false);
  });

  it('keeps the first eligible pool of a pair', async () => {
    const second = pool(NATIVE, X, 2_000_000_000_000n, 500_000_000_000n);
    const rates = await estimator(chainWith([deepPool, second])).feeTokenRates();
    expect(rates.get(X)).toEqual((await estimator(chainWith([deepPool])).feeTokenRates()).get(X));
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
  it('prices BZE: gas 200,000 gives limit 300,000 and a fee of 3,000 ubze', async () => {
    const chain = chainWith([]);
    const result = await estimate(estimator(chain), [[NATIVE, 5_000n]]);
    expect(result).toEqual({
      options: [{ denom: NATIVE, amount: 3_000n, gasLimit: 300_000n }],
      default: NATIVE,
      gasUsed: 200_000n,
    });
    expect(chain.simulate).toHaveBeenCalledWith(simulationTxBytes(body, pubKey, 7n));
  });

  it('gives a fee in another token the gas of the swap: limit 450,000 and 2,475 uX', async () => {
    // 200,000 simulated -> 300,000 native -> 450,000 with the swap; 4,500 ubze at 0.01,
    // 2,250 uX at 2 BZE per X, plus 10% slippage.
    const result = await estimate(estimator(chainWith([deepPool])), [[X, 10_000n]]);
    expect(result.options).toEqual([{ denom: X, amount: 2_475n, gasLimit: 450_000n }]);
    expect(result.default).toBe(X);
  });

  it('gives each option its own gas limit', async () => {
    const result = await estimate(estimator(chainWith([deepPool], { gasUsed: 76_403n })), [
      [NATIVE, 10n ** 9n],
      [X, 10n ** 9n],
    ]);
    const [native, token] = result.options;
    expect(native?.gasLimit).toBe(114_605n);
    // At least 2.25x what the simulation measured, so the swap fits.
    expect(token?.gasLimit).toBe(171_908n);
    expect((token?.gasLimit ?? 0n) * 100n).toBeGreaterThanOrEqual(76_403n * 225n);
  });

  it('offers nothing when the payer holds one unit less than the fee', async () => {
    const result = await estimate(estimator(chainWith([deepPool])), [[X, 2_474n]]);
    expect(result).toEqual({ options: [], default: null, gasUsed: 200_000n });
  });

  it('offers a token that is held exactly', async () => {
    const result = await estimate(estimator(chainWith([deepPool])), [[X, 2_475n]]);
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
    // 1 gas used -> limit ceil(1.5) = 2; 0.01 × 2 = 0.02 -> 1 ubze
    const small = await estimate(estimator(chainWith([], { gasUsed: 1n })), [[NATIVE, 5n]]);
    expect(small.options).toEqual([{ denom: NATIVE, amount: 1n, gasLimit: 2n }]);
    // exact multiple does not round up: 10 gas -> 15
    const exact = await estimate(estimator(chainWith([], { gasUsed: 10n })), [[NATIVE, 5n]]);
    expect(exact.options[0]?.gasLimit).toBe(15n);
    // gas 1 -> 2 -> ceil(3) = 3; 0.03 ubze -> 1; ÷ 2 × 1.1 = 0.55 uX -> 1
    const token = await estimate(estimator(chainWith([deepPool], { gasUsed: 1n })), [[X, 5n]]);
    expect(token.options).toEqual([{ denom: X, amount: 1n, gasLimit: 3n }]);
    // the native fee is rounded up before the conversion: gas 3 -> 5 -> 8 -> 0.08 -> 1 ubze,
    // which at 1 BZE per uY is 1.1 -> 2 uY (one rounding at the end would give 0.088 -> 1)
    const even = pool(NATIVE, Y, MIN_LIQUIDITY, MIN_LIQUIDITY);
    const stepwise = await estimate(estimator(chainWith([even], { gasUsed: 3n })), [[Y, 5n]]);
    expect(stepwise.options).toEqual([{ denom: Y, amount: 2n, gasLimit: 8n }]);
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
    // limit = 1.5e24 × 1.5 = 2.25e24, fee = 2.25e24 × 0.01 × 1/2 × 1.1 = 1.2375e22
    expect(result.options).toEqual([
      {
        denom: X,
        amount: 12_375_000_000_000_000_000_000n,
        gasLimit: 2_250_000_000_000_000_000_000_000n,
      },
    ]);
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
    expect(cache.ttls.get('fees:rates:v2')).toBe(FEE_TTL_MS);
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
    cache.store.set('fees:rates:v2', entry);
    const rates = await estimator(chain, { cache }).feeTokenRates();
    expect(rates.has(NATIVE)).toBe(true);
    expect(chain.feeParams).toHaveBeenCalledTimes(1);
  });
});

describe('minimumFee', () => {
  it('is ceil(gas x price) in BZE, with no margin', async () => {
    const data = await estimator(chainWith([])).feeData();
    expect(minimumFee(data, NATIVE, 300_000n)).toBe(3_000n);
    expect(minimumFee(data, NATIVE, 300_001n)).toBe(3_001n);
  });

  it('converts the BZE minimum at the spot ratio for another token, without the 10% margin', async () => {
    const data = await estimator(chainWith([deepPool])).feeData();
    // 450,000 gas -> 4,500 ubze -> 2,250 uX at 2 BZE per X (the estimate adds 10% on top).
    expect(minimumFee(data, X, 450_000n)).toBe(2_250n);
    // 450,100 gas -> 4,501 ubze -> 2,250.5 uX, rounded up.
    expect(minimumFee(data, X, 450_100n)).toBe(2_251n);
  });

  it('is null for a token that cannot pay the fee', async () => {
    const data = await estimator(chainWith([deepPool])).feeData();
    expect(minimumFee(data, Y, 300_000n)).toBeNull();
  });

  it('is zero everywhere when the gas price is zero', async () => {
    const data = await estimator(chainWith([deepPool], { gasPrice: '0' })).feeData();
    expect(minimumFee(data, NATIVE, 300_000n)).toBe(0n);
    expect(minimumFee(data, X, 300_000n)).toBe(0n);
  });
});

describe('feeAt', () => {
  it('gives back every option of the estimate at its own gas limit and the minimum price', async () => {
    const fees = estimator(chainWith([deepPool], { gasUsed: 76_403n }));
    const result = await estimate(fees, [
      [NATIVE, 10n ** 9n],
      [X, 10n ** 9n],
    ]);
    const data = await fees.feeData();
    expect(result.options).toHaveLength(2);
    for (const o of result.options) {
      const pricing = feePricing(data, o.denom);
      expect(pricing).not.toBeNull();
      if (pricing) expect(feeAt(pricing, o.gasLimit)).toBe(o.amount);
    }
  });

  it('prices any gas limit with the same round-ups: 250,000 gas is 2,500 ubze or 1,375 uX', async () => {
    const data = await estimator(chainWith([deepPool])).feeData();
    const native = feePricing(data, NATIVE);
    const token = feePricing(data, X);
    expect(native?.native).toBe(true);
    expect(token?.native).toBe(false);
    if (!native || !token) return;
    expect(feeAt(native, 250_000n)).toBe(2_500n);
    expect(feeAt(native, 250_001n)).toBe(2_501n);
    // 2,500 ubze -> 1,250 uX at 2 BZE per X, plus 10%.
    expect(feeAt(token, 250_000n)).toBe(1_375n);
  });

  it('multiplies the gas price, not the spot ratio, for x2 and x3', async () => {
    const data = await estimator(chainWith([deepPool])).feeData();
    const native = feePricing(data, NATIVE);
    const token = feePricing(data, X);
    if (!native || !token) throw new Error('no pricing');
    expect(feeAt(native, 250_000n, 2n)).toBe(5_000n);
    expect(feeAt(native, 250_000n, 3n)).toBe(7_500n);
    // 7,500 ubze -> 3,750 uX -> 4,125 uX with the margin.
    expect(feeAt(token, 250_000n, 3n)).toBe(4_125n);
    // The native fee is rounded up after the multiplier: 3 gas x 0.02 = 0.06 -> 1 ubze.
    expect(feeAt(native, 3n, 2n)).toBe(1n);
  });

  it('is zero at a zero gas price and null pricing for a token that cannot pay', async () => {
    const data = await estimator(chainWith([deepPool], { gasPrice: '0' })).feeData();
    const token = feePricing(data, X);
    if (!token) throw new Error('no pricing');
    expect(feeAt(token, 300_000n, 3n)).toBe(0n);
    expect(feePricing(data, Y)).toBeNull();
  });
});

describe('gas price multipliers', () => {
  it('are the minimum, twice and three times it, and nothing else', () => {
    expect(GAS_PRICE_MULTIPLIERS).toEqual([1n, 2n, 3n]);
    expect([0n, 1n, 2n, 3n, 4n].map(isGasPriceMultiplier)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('gasLimitBounds', () => {
  it('is the simulation, the estimate and ten times it for a BZE fee', () => {
    expect(gasLimitBounds(82_417n, true)).toEqual({
      min: 82_417n,
      estimate: 123_626n,
      max: 1_236_260n,
    });
  });

  it('starts at the native estimate for a fee in another token, whose swap the simulation leaves out', () => {
    expect(gasLimitBounds(82_417n, false)).toEqual({
      min: 123_626n,
      estimate: 185_439n,
      max: 1_854_390n,
    });
  });
});

describe('quickGasLimits', () => {
  it('rounds x1.5, x2 and x5 of the estimate up to two significant digits', () => {
    expect(quickGasLimits(gasLimitBounds(82_417n, true))).toEqual([
      { pick: 'auto', gasLimit: 123_626n },
      { pick: 'x1.5', gasLimit: 190_000n },
      { pick: 'x2', gasLimit: 250_000n },
      { pick: 'x5', gasLimit: 620_000n },
      { pick: 'max', gasLimit: 1_236_260n },
    ]);
  });

  it('never goes above the maximum, and never below the minimum', () => {
    // estimate 99,999: x5 = 499,995 -> 500,000; max = 999,990.
    const bounds = { min: 66_666n, estimate: 99_999n, max: 999_990n };
    const picks = quickGasLimits(bounds);
    expect(picks.map((p) => p.gasLimit)).toEqual([99_999n, 150_000n, 200_000n, 500_000n, 999_990n]);
    // A cap right above the estimate clamps every rounded pick to it.
    const tight = quickGasLimits({ min: 10n, estimate: 99_999n, max: 140_000n });
    expect(tight.map((p) => p.gasLimit)).toEqual([99_999n, 140_000n, 140_000n, 140_000n, 140_000n]);
    for (const p of [...picks, ...tight]) expect(p.gasLimit).toBeGreaterThanOrEqual(99_999n);
  });

  it('leaves tiny limits exact', () => {
    expect(quickGasLimits({ min: 1n, estimate: 2n, max: 20n }).map((p) => p.gasLimit)).toEqual([
      2n,
      3n,
      4n,
      10n,
      20n,
    ]);
  });
});

describe('priceGasOverride', () => {
  async function pricings() {
    const data = await estimator(chainWith([deepPool])).feeData();
    const native = feePricing(data, NATIVE);
    const token = feePricing(data, X);
    if (!native || !token) throw new Error('no pricing');
    return { native, token };
  }
  const run = (
    pricing: Parameters<typeof priceGasOverride>[0]['pricing'],
    gasLimit: bigint,
    extra: { gasPrice?: 1n | 2n | 3n; spendable?: bigint } = {},
  ) =>
    priceGasOverride({
      pricing,
      gasUsed: 82_417n,
      gasLimit,
      gasPrice: extra.gasPrice ?? 1n,
      spendable: extra.spendable ?? 10n ** 12n,
    });

  it('refuses below the simulation, warns below the estimate and accepts from it on (BZE)', async () => {
    const { native } = await pricings();
    expect(run(native, 82_416n).status).toBe('low');
    expect(run(native, 82_417n).status).toBe('warn');
    expect(run(native, 123_625n).status).toBe('warn');
    expect(run(native, 123_626n)).toEqual({
      status: 'ok',
      amount: 1_237n,
      bounds: { min: 82_417n, estimate: 123_626n, max: 1_236_260n },
    });
    expect(run(native, 1_236_260n).status).toBe('ok');
    expect(run(native, 1_236_261n).status).toBe('high');
  });

  it('starts the foreign floor at the native estimate, for the fee swap', async () => {
    const { token } = await pricings();
    expect(run(token, 123_625n).status).toBe('low');
    expect(run(token, 123_626n).status).toBe('warn');
    expect(run(token, 185_439n).status).toBe('ok');
  });

  it('refuses a fee above what may be spent, at the picked price', async () => {
    const { native } = await pricings();
    // 250,000 gas: 2,500 ubze at the minimum, 5,000 at x2.
    expect(run(native, 250_000n, { spendable: 2_500n }).status).toBe('ok');
    expect(run(native, 250_000n, { spendable: 2_500n, gasPrice: 2n })).toMatchObject({
      status: 'afford',
      amount: 5_000n,
    });
  });
});
