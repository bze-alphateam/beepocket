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
  /** Every denom that can pay the fee, the native one included. */
  rates: Map<string, Rate>;
}

export interface FeeOption {
  denom: string;
  amount: bigint;
}

export interface FeeEstimate {
  gasLimit: bigint;
  /** Eligible denoms the payer holds enough of: native first, then by symbol. */
  options: FeeOption[];
  /** The denom to pre-select, null when the payer can pay with none. */
  default: string | null;
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

// Gas limit = simulated gas x 1.3; token gas price = native price / spot x 1.05.
const GAS_HEADROOM = { num: 13n, den: 10n };
const PRICE_HEADROOM = { num: 105n, den: 100n };
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
    this.cacheKey = `${options.cacheKeyPrefix ?? ''}fees:rates`;
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
      // A pool the node reports as halted cannot price a swap: leave the token out.
      if (pool.halted === true) continue;
      if (found.native < params.minNativeLiquidityForModuleSwap) continue;
      // An empty side has no spot price (and would divide by zero).
      if (found.native === 0n || found.token === 0n) continue;
      rates.set(found.denom, {
        num: nativePrice.num * found.token * PRICE_HEADROOM.num,
        den: nativePrice.den * found.native * PRICE_HEADROOM.den,
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
    const gasLimit = ceilDiv(simulation.gasUsed * GAS_HEADROOM.num, GAS_HEADROOM.den);

    const affordable: FeeOption[] = [];
    for (const [denom, rate] of data.rates) {
      const amount = ceilDiv(gasLimit * rate.num, rate.den);
      if ((params.balances.get(denom) ?? 0n) >= amount) affordable.push({ denom, amount });
    }
    const options = await this.order(affordable, data.nativeDenom);

    const has = (denom: string | undefined): denom is string =>
      denom !== undefined && options.some((o) => o.denom === denom);
    const selected = [data.nativeDenom, params.preferred].find(has) ?? options[0]?.denom ?? null;
    return { gasLimit, options, default: selected };
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
