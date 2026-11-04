import type { Cache } from './cache';
import { FEE_TTL_MS } from './cache';
import type { ChainClient, Clock, Pool } from './net';
import { UnexpectedResponseError } from './net';
import { simulationTxBytes } from './tx';

/** A gas price as an exact fraction: base units per unit of gas. */
export interface Rate {
  num: bigint;
  den: bigint;
}

/** What the chain says about fees right now. */
export interface FeeData {
  nativeDenom: string;
  /**
   * The chain's minimum gas price in every denom that can pay the fee, the native one
   * included: the native price converted at the pool's spot ratio, with no margin.
   */
  rates: Map<string, Rate>;
}

export interface FeeOption {
  denom: string;
  amount: bigint;
  /**
   * The gas limit this fee pays for. Paying in another token costs more gas than paying in
   * the native one (the fee is swapped to the native token before the messages run), so each
   * option carries its own limit and the transaction must be signed with it.
   */
  gasLimit: bigint;
}

export interface FeeEstimate {
  /** Eligible denoms the payer holds enough of: native first, then by symbol. */
  options: FeeOption[];
  /** The denom to pre-select, null when the payer can pay with none. */
  default: string | null;
  /** The gas the simulation used, before any headroom. */
  gasUsed: bigint;
}

export interface EstimateParams {
  bodyBytes: Uint8Array;
  pubKey: Uint8Array;
  sequence: bigint;
  /** The paying address's balances. */
  balances: Map<string, bigint>;
  /** The user's selected token; used as the default when the native token is not an option. */
  preferred?: string;
}

/** Where symbols come from when sorting options; `TokenResolver` fits. */
export interface SymbolSource {
  resolve(denom: string): Promise<{ symbol: string }>;
}

export interface FeeEstimatorOptions {
  cache?: Cache;
  /** Prefix of the cache key, so one store can serve several networks. */
  cacheKeyPrefix?: string;
  /** Without it options are ordered by denom after the native one. */
  tokens?: SymbolSource;
}

// The simulation runs with an empty fee, so it never pays for the fee deduction, and a fee in
// another token is swapped to the native one by the ante handler before the messages run. The
// margins match the BZE dapps:
//   gasLimit   = ceil(simulated x 1.5)                       (native fee)
//   foreignGas = ceil(gasLimit x 1.5)                        (fee in another token)
//   foreignFee = ceil(ceil(foreignGas x price) / spot x 1.1) (spot = native per token)
const GAS_HEADROOM = { num: 15n, den: 10n };
const FOREIGN_GAS_HEADROOM = { num: 15n, den: 10n };
const FOREIGN_FEE_SLIPPAGE = { num: 11n, den: 10n };
const MAX_PRICE_DIGITS = 40;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/** `"0.010000000000000000"` as the exact fraction 10000000000000000 / 10^18. */
function parseGasPrice(amount: string): Rate {
  const [whole = '', fraction = ''] = amount.split('.');
  if (amount.length > MAX_PRICE_DIGITS)
    throw new UnexpectedResponseError('params.ValidatorMinGasFee.amount', 'too many digits');
  return { num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
}

/** A multiple of the chain's minimum gas price. BZE has no fee market, so only these few. */
export type GasPriceMultiplier = 1n | 2n | 3n;

/** The gas price picks, lowest first: the chain minimum, then twice and three times it. */
export const GAS_PRICE_MULTIPLIERS: readonly GasPriceMultiplier[] = [1n, 2n, 3n];

export function isGasPriceMultiplier(x: bigint): x is GasPriceMultiplier {
  return x === 1n || x === 2n || x === 3n;
}

/** What pricing a fee in one denom takes: the native gas price and that denom's rate. */
export interface FeePricing {
  /** The fee is in the native denom (no swap, no slippage margin). */
  native: boolean;
  /** The chain's minimum gas price in the native denom. */
  nativePrice: Rate;
  /** The minimum gas price in this denom (the native one converted at the spot ratio). */
  rate: Rate;
}

/** The pricing of a fee in `denom`, or null when `denom` cannot pay the fee. */
export function feePricing(data: FeeData, denom: string): FeePricing | null {
  const rate = data.rates.get(denom);
  const nativePrice = data.rates.get(data.nativeDenom);
  if (!rate || !nativePrice) return null;
  return { native: denom === data.nativeDenom, nativePrice, rate };
}

/**
 * The fee for `gasLimit` at `multiplier` times the minimum gas price, every step rounded up:
 * `ceil(gasLimit x price)` in the native denom; in another token that native fee converted at
 * the spot ratio (`rate / nativePrice`, never multiplied) times the slippage margin. The
 * wallet's own estimate is this at the estimated gas limit and a multiplier of 1.
 */
export function feeAt(
  pricing: FeePricing,
  gasLimit: bigint,
  multiplier: GasPriceMultiplier = 1n,
): bigint {
  const { nativePrice, rate } = pricing;
  if (pricing.native) return ceilDiv(gasLimit * rate.num * multiplier, rate.den);
  // A zero gas price makes every fee zero (and the ratio undefined).
  if (nativePrice.num === 0n) return 0n;
  const native = ceilDiv(gasLimit * nativePrice.num * multiplier, nativePrice.den);
  return ceilDiv(
    native * rate.num * nativePrice.den * FOREIGN_FEE_SLIPPAGE.num,
    rate.den * nativePrice.num * FOREIGN_FEE_SLIPPAGE.den,
  );
}

/** The wallet's gas limit for a simulation: `ceil(gasUsed x 1.5)`, and x 1.5 again for a fee swap. */
export function estimatedGasLimit(gasUsed: bigint, native: boolean): bigint {
  const nativeGas = ceilDiv(gasUsed * GAS_HEADROOM.num, GAS_HEADROOM.den);
  return native
    ? nativeGas
    : ceilDiv(nativeGas * FOREIGN_GAS_HEADROOM.num, FOREIGN_GAS_HEADROOM.den);
}

/** The gas limits a user may pick for a fee: never below `min`, never above `max`. */
export interface GasLimitBounds {
  /**
   * What the simulation used; for a fee in another token the native estimate, because the
   * simulation leaves out the swap of the fee.
   */
  min: bigint;
  /** The wallet's own gas limit (`estimatedGasLimit`). Below it the transaction may run out. */
  estimate: bigint;
  /** Ten times the estimate. */
  max: bigint;
}

const MAX_GAS_TIMES = 10n;

export function gasLimitBounds(gasUsed: bigint, native: boolean): GasLimitBounds {
  const estimate = estimatedGasLimit(gasUsed, native);
  return {
    min: native ? gasUsed : estimatedGasLimit(gasUsed, true),
    estimate,
    max: estimate * MAX_GAS_TIMES,
  };
}

export type QuickGasPick = 'auto' | 'x1.5' | 'x2' | 'x5' | 'max';

/** `n` rounded up to two significant digits: 185,439 → 190,000. */
function tidyUp(n: bigint): bigint {
  const step = 10n ** BigInt(Math.max(0, n.toString().length - 2));
  return ceilDiv(n, step) * step;
}

/**
 * The quick picks under the gas limit field. Each multiplies the estimate; x1.5, x2 and x5 are
 * rounded up to two significant digits and never go above the maximum, which is the last pick
 * exactly. None is below the minimum, since they all start at the estimate.
 */
export function quickGasLimits(bounds: GasLimitBounds): { pick: QuickGasPick; gasLimit: bigint }[] {
  const times = (num: bigint, den: bigint): bigint => {
    const tidy = tidyUp(ceilDiv(bounds.estimate * num, den));
    return tidy > bounds.max ? bounds.max : tidy;
  };
  return [
    { pick: 'auto', gasLimit: bounds.estimate },
    { pick: 'x1.5', gasLimit: times(3n, 2n) },
    { pick: 'x2', gasLimit: times(2n, 1n) },
    { pick: 'x5', gasLimit: times(5n, 1n) },
    { pick: 'max', gasLimit: bounds.max },
  ];
}

/**
 * What the user's gas limit and price give: `low` below the minimum and `high` above the
 * maximum (both refused), `afford` when the fee is more than `spendable` (refused), `warn`
 * below the estimate (allowed: the transaction may run out of gas), `ok` otherwise. The popup
 * shows it live and the worker runs it again on fresh numbers before it signs.
 */
export type GasOverrideStatus = 'ok' | 'warn' | 'low' | 'high' | 'afford';

export interface PricedGasOverride {
  status: GasOverrideStatus;
  /** The fee for `gasLimit` at the picked price. */
  amount: bigint;
  bounds: GasLimitBounds;
}

export function priceGasOverride(params: {
  pricing: FeePricing;
  /** What the simulation used. */
  gasUsed: bigint;
  gasLimit: bigint;
  gasPrice: GasPriceMultiplier;
  /** What the fee may take of its token (the balance, less a sent amount in the same token). */
  spendable: bigint;
}): PricedGasOverride {
  const bounds = gasLimitBounds(params.gasUsed, params.pricing.native);
  const amount = feeAt(params.pricing, params.gasLimit, params.gasPrice);
  const status: GasOverrideStatus =
    params.gasLimit < bounds.min
      ? 'low'
      : params.gasLimit > bounds.max
        ? 'high'
        : amount > params.spendable
          ? 'afford'
          : params.gasLimit < bounds.estimate
            ? 'warn'
            : 'ok';
  return { status, amount, bounds };
}

/**
 * The least fee the chain takes in `denom` for `gasLimit`, with no margin: `ceil(gasLimit x
 * minimum gas price)` in the native token, and that native fee converted at the pool's spot
 * ratio (rounded up) in another token. `null` when `denom` cannot pay the fee at all.
 */
export function minimumFee(data: FeeData, denom: string, gasLimit: bigint): bigint | null {
  const rate = data.rates.get(denom);
  const nativePrice = data.rates.get(data.nativeDenom);
  if (!rate || !nativePrice) return null;
  const native = ceilDiv(gasLimit * nativePrice.num, nativePrice.den);
  if (denom === data.nativeDenom) return native;
  if (nativePrice.num === 0n) return 0n;
  return ceilDiv(native * rate.num * nativePrice.den, rate.den * nativePrice.num);
}

/** The pool pairing the native denom with `denom`, whichever side each is on. */
function nativeReserves(
  pool: Pool,
  native: string,
): { denom: string; native: bigint; token: bigint } | null {
  if (pool.base === native && pool.quote !== native)
    return { denom: pool.quote, native: pool.reserveBase, token: pool.reserveQuote };
  if (pool.quote === native && pool.base !== native)
    return { denom: pool.base, native: pool.reserveQuote, token: pool.reserveBase };
  return null;
}

/** Which tokens can pay the network fee, and what it costs. Mirrors the chain's own rule. */
export class FeeEstimator {
  private readonly cache: Cache | undefined;
  private readonly cacheKey: string;
  private readonly tokens: SymbolSource | undefined;

  constructor(
    private readonly chain: ChainClient,
    private readonly clock: Clock,
    options: FeeEstimatorOptions = {},
  ) {
    this.cache = options.cache;
    this.cacheKey = `${options.cacheKeyPrefix ?? ''}fees:rates:v2`;
    this.tokens = options.tokens;
  }

  /** Gas price per eligible denom. */
  async feeTokenRates(): Promise<Map<string, Rate>> {
    return (await this.feeData()).rates;
  }

  async feeData(): Promise<FeeData> {
    const cached = this.readCache(await this.cache?.get(this.cacheKey));
    if (cached) return cached;

    const [fee, params, pools, halted] = await Promise.all([
      this.chain.feeParams(),
      this.chain.tradebinParams(),
      this.chain.liquidityPools(),
      this.chain.haltedDenoms(),
    ]);
    const native = params.nativeDenom;
    if (fee.minGasPrice.denom !== native)
      throw new UnexpectedResponseError(
        'params.ValidatorMinGasFee.denom',
        'gas price is not in the native denom',
      );
    const nativePrice = parseGasPrice(fee.minGasPrice.amount);
    const haltedSet = new Set(halted);

    const rates = new Map<string, Rate>([[native, nativePrice]]);
    for (const pool of pools) {
      const found = nativeReserves(pool, native);
      if (!found || rates.has(found.denom) || haltedSet.has(found.denom)) continue;
      // Eligibility is checked per pool, so an unusable pool never hides a usable one.
      // A pool the node reports as halted cannot price a swap: leave the token out.
      if (pool.halted === true) continue;
      if (found.native < params.minNativeLiquidityForModuleSwap) continue;
      // An empty side has no spot price (and would divide by zero).
      if (found.native === 0n || found.token === 0n) continue;
      rates.set(found.denom, {
        num: nativePrice.num * found.token,
        den: nativePrice.den * found.native,
      });
    }

    const data = { nativeDenom: native, rates };
    await this.cache?.set(this.cacheKey, this.serialize(data), FEE_TTL_MS);
    return data;
  }

  /** Simulates the transaction and prices its fee in every denom the payer can pay with. */
  async estimate(params: EstimateParams): Promise<FeeEstimate> {
    const [simulation, data] = await Promise.all([
      this.chain.simulate(simulationTxBytes(params.bodyBytes, params.pubKey, params.sequence)),
      this.feeData(),
    ]);
    const affordable: FeeOption[] = [];
    for (const denom of data.rates.keys()) {
      const pricing = feePricing(data, denom);
      if (!pricing) throw new UnexpectedResponseError('fees.rates', 'no native gas price');
      const gasLimit = estimatedGasLimit(simulation.gasUsed, pricing.native);
      const option = { denom, amount: feeAt(pricing, gasLimit), gasLimit };
      if ((params.balances.get(denom) ?? 0n) >= option.amount) affordable.push(option);
    }
    const options = await this.order(affordable, data.nativeDenom);

    const has = (denom: string | undefined): denom is string =>
      denom !== undefined && options.some((o) => o.denom === denom);
    const selected = [data.nativeDenom, params.preferred].find(has) ?? options[0]?.denom ?? null;
    return { options, default: selected, gasUsed: simulation.gasUsed };
  }

  private async order(options: FeeOption[], native: string): Promise<FeeOption[]> {
    const symbols = new Map<string, string>();
    await Promise.all(
      options.map(async (o) => {
        const symbol = await this.tokens?.resolve(o.denom).then(
          (t) => t.symbol,
          () => o.denom,
        );
        symbols.set(o.denom, symbol ?? o.denom);
      }),
    );
    const sortKey = (o: FeeOption): [number, string, string] => [
      o.denom === native ? 0 : 1,
      symbols.get(o.denom) ?? o.denom,
      o.denom,
    ];
    return [...options].sort((a, b) => {
      const [ka, kb] = [sortKey(a), sortKey(b)];
      return (
        ka[0] - kb[0] ||
        (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0) ||
        (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0)
      );
    });
  }

  private serialize(data: FeeData): unknown {
    return {
      fetchedAt: this.clock.now(),
      nativeDenom: data.nativeDenom,
      rates: [...data.rates].map(([denom, r]) => [denom, r.num.toString(), r.den.toString()]),
    };
  }

  /** Cached values come from a store that may ignore the TTL or hold junk: check everything. */
  private readCache(value: unknown): FeeData | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as { fetchedAt?: unknown; nativeDenom?: unknown; rates?: unknown };
    if (typeof v.fetchedAt !== 'number' || typeof v.nativeDenom !== 'string') return null;
    const age = this.clock.now() - v.fetchedAt;
    if (age < 0 || age >= FEE_TTL_MS || !Array.isArray(v.rates)) return null;
    const rates = new Map<string, Rate>();
    for (const row of v.rates as unknown[]) {
      if (!Array.isArray(row) || row.length !== 3) return null;
      const [denom, num, den] = row as unknown[];
      if (typeof denom !== 'string' || typeof num !== 'string' || typeof den !== 'string')
        return null;
      if (!/^\d+$/.test(num) || !/^[1-9]\d*$/.test(den)) return null;
      rates.set(denom, { num: BigInt(num), den: BigInt(den) });
    }
    return rates.has(v.nativeDenom) ? { nativeDenom: v.nativeDenom, rates } : null;
  }
}
