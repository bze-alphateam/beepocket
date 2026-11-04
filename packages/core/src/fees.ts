import type { Cache } from './cache';
import { FEE_TTL_MS } from './cache';
import type { ChainClient, Clock, Pool } from './net';
import { HttpStatusError, SimulationError, TransportError, UnexpectedResponseError } from './net';
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
   * The gas limit this fee pays for. Paying in another token can cost more gas than paying in
   * the native one (a module fee in the transaction is swapped to the native token), so each
   * option carries its own limit and the transaction must be signed with it.
   */
  gasLimit: bigint;
  /** What the simulation with a fee in this option's kind of token used, before any margin. */
  gasUsed: bigint;
}

/** What the simulations used, before any margin. */
export interface SimulatedGas {
  /**
   * With a fee of one native base unit (no fee when the payer holds none); null when it failed
   * and the other one did not.
   */
  native: bigint | null;
  /** With a fee of one unit of another token; null when it was not run or failed. */
  foreign: bigint | null;
}

export interface FeeEstimate {
  /** Eligible denoms the payer holds enough of: native first, then by symbol. */
  options: FeeOption[];
  /** The denom to pre-select, null when the payer can pay with none. */
  default: string | null;
  /** What each simulation used. Every option carries the one matching its token. */
  simulated: SimulatedGas;
}

/** The simulation matching a fee in the native or another token; null when it did not run. */
export function simulatedGasFor(simulated: SimulatedGas, native: boolean): bigint | null {
  return native ? simulated.native : simulated.foreign;
}

export interface EstimateParams {
  bodyBytes: Uint8Array;
  pubKey: Uint8Array;
  sequence: bigint;
  /** The paying address's balances. */
  balances: Map<string, bigint>;
  /**
   * The user's selected token: the default when the native token is not an option, and the
   * token the fee in another token is simulated with when it can pay and the payer holds it.
   */
  preferred?: string;
  /**
   * What the transaction's own messages take of each token (a send's amount), when the caller
   * knows it. A fee coin is simulated in a token only when one unit is left next to it.
   */
  spent?: Map<string, bigint>;
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

// The transaction is simulated with a real fee of one unit, once in the native token and once in
// one other token, so the chain measures the fee deduction and, for a module fee paid in
// another token, its swap to the native one. Every fee in another token takes the same path
// (one hop against the native token), so one of them stands for all. The margins match the BZE
// dapps:
//   gasLimit   = ceil(simulated x 1.2)                     (simulated with a fee in the token's kind)
//   foreignFee = ceil(ceil(gasLimit x price) / spot x 1.1) (spot = native per token)
const GAS_HEADROOM = { num: 12n, den: 10n };
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

/** The wallet's gas limit for a simulation: `ceil(gasUsed x 1.2)`. */
function estimatedGasLimit(gasUsed: bigint): bigint {
  return ceilDiv(gasUsed * GAS_HEADROOM.num, GAS_HEADROOM.den);
}

/** The gas limits a user may pick for a fee: never below `min`, never above `max`. */
export interface GasLimitBounds {
  /** What the simulation with a fee in this token's kind used. */
  min: bigint;
  /** The wallet's own gas limit (`estimatedGasLimit`). Below it the transaction may run out. */
  estimate: bigint;
  /** Ten times the estimate. */
  max: bigint;
}

const MAX_GAS_TIMES = 10n;

/** The bounds for a fee whose token's kind of simulation used `gasUsed`. */
export function gasLimitBounds(gasUsed: bigint): GasLimitBounds {
  const estimate = estimatedGasLimit(gasUsed);
  return {
    min: gasUsed,
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
  /** What the simulation matching the fee's token used (`simulatedGasFor`, `FeeOption.gasUsed`). */
  gasUsed: bigint;
  gasLimit: bigint;
  gasPrice: GasPriceMultiplier;
  /** What the fee may take of its token (the balance, less a sent amount in the same token). */
  spendable: bigint;
}): PricedGasOverride {
  const bounds = gasLimitBounds(params.gasUsed);
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

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(run: Promise<T>): Promise<Settled<T>> {
  return run.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/**
 * A simulation's gas, or null when the node refused it or could not be reached. Anything else
 * is a bug and propagates.
 */
function gasOf(run: Settled<bigint>): bigint | null {
  if (run.ok) return run.value;
  const { error } = run;
  if (
    error instanceof SimulationError ||
    error instanceof TransportError ||
    error instanceof HttpStatusError ||
    error instanceof UnexpectedResponseError
  )
    return null;
  throw error;
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

  /**
   * Simulates the transaction and prices its fee in every denom the payer can pay with. It runs
   * at most two simulations, side by side: one with a fee of one native base unit, and one with
   * a fee of one unit of another token the payer has a unit of to spare after `spent`
   * (`preferred` when it qualifies, else the first in option order). Native options come from the first, every other from the second.
   * One failing leaves its options out; both failing (or the native one, when the other did not
   * run) throws the native one's error.
   */
  async estimate(params: EstimateParams): Promise<FeeEstimate> {
    const left = (denom: string) =>
      (params.balances.get(denom) ?? 0n) - (params.spent?.get(denom) ?? 0n);
    const held = (denom: string) => left(denom) >= 1n;
    const simulateWith = (fee: { denom: string; amount: string }[]) =>
      this.chain
        .simulate(simulationTxBytes(params.bodyBytes, params.pubKey, params.sequence, fee))
        .then((r) => r.gasUsed);
    // The native denom and the eligible tokens come from the fee data (cached), so both
    // simulations start once it is read.
    const data = await this.feeData();
    const native = data.nativeDenom;
    // A payer with no native unit to spare cannot fund a fee coin in it: no fee, as it cannot
    // pay a native fee anyway.
    const nativeRun = settle(simulateWith(held(native) ? [{ denom: native, amount: '1' }] : []));
    const representative = await this.representative(data, params, held);
    const foreignRun =
      representative === null
        ? null
        : settle(simulateWith([{ denom: representative, amount: '1' }]));
    const [nativeResult, foreignResult] = await Promise.all([nativeRun, foreignRun]);
    const simulated: SimulatedGas = {
      native: gasOf(nativeResult),
      foreign: foreignResult && gasOf(foreignResult),
    };
    if (!nativeResult.ok && simulated.foreign === null) throw nativeResult.error;

    const affordable: FeeOption[] = [];
    for (const denom of data.rates.keys()) {
      const pricing = feePricing(data, denom);
      if (!pricing) throw new UnexpectedResponseError('fees.rates', 'no native gas price');
      const gasUsed = simulatedGasFor(simulated, pricing.native);
      if (gasUsed === null) continue;
      const gasLimit = estimatedGasLimit(gasUsed);
      const option = { denom, amount: feeAt(pricing, gasLimit), gasLimit, gasUsed };
      if ((params.balances.get(denom) ?? 0n) >= option.amount) affordable.push(option);
    }
    const options = await this.order(affordable, native);

    const has = (denom: string | undefined): denom is string =>
      denom !== undefined && options.some((o) => o.denom === denom);
    const selected = [native, params.preferred].find(has) ?? options[0]?.denom ?? null;
    return { options, default: selected, simulated };
  }

  /** The other token the fee is simulated in: null when none can pay or the payer holds none. */
  private async representative(
    data: FeeData,
    params: EstimateParams,
    held: (denom: string) => boolean,
  ): Promise<string | null> {
    const candidates = [...data.rates.keys()].filter((d) => d !== data.nativeDenom && held(d));
    const { preferred } = params;
    if (preferred !== undefined && candidates.includes(preferred)) return preferred;
    const [first] = await this.order(
      candidates.map((denom) => ({ denom })),
      data.nativeDenom,
    );
    return first?.denom ?? null;
  }

  private async order<T extends { denom: string }>(options: T[], native: string): Promise<T[]> {
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
    const sortKey = (o: T): [number, string, string] => [
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
