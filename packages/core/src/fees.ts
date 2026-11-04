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

/**
 * The fee in a token for `gas`: the native fee `ceil(gas x nativePrice)` converted at the spot
 * ratio (`rate / nativePrice`), times the slippage margin, rounded up once more.
 */
function foreignFee(gas: bigint, nativePrice: Rate, rate: Rate): bigint {
  // A zero gas price makes every fee zero (and the ratio undefined).
  if (nativePrice.num === 0n) return 0n;
  const native = ceilDiv(gas * nativePrice.num, nativePrice.den);
  return ceilDiv(
    native * rate.num * nativePrice.den * FOREIGN_FEE_SLIPPAGE.num,
    rate.den * nativePrice.num * FOREIGN_FEE_SLIPPAGE.den,
  );
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
    const nativeGas = ceilDiv(simulation.gasUsed * GAS_HEADROOM.num, GAS_HEADROOM.den);
    const foreignGas = ceilDiv(nativeGas * FOREIGN_GAS_HEADROOM.num, FOREIGN_GAS_HEADROOM.den);
    const nativePrice = data.rates.get(data.nativeDenom);
    if (!nativePrice) throw new UnexpectedResponseError('fees.rates', 'no native gas price');

    const affordable: FeeOption[] = [];
    for (const [denom, rate] of data.rates) {
      const option =
        denom === data.nativeDenom
          ? { denom, amount: ceilDiv(nativeGas * rate.num, rate.den), gasLimit: nativeGas }
          : { denom, amount: foreignFee(foreignGas, nativePrice, rate), gasLimit: foreignGas };
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
