import type { FeePricing, GasPriceMultiplier } from '@beepocket/core';
import type { FeeOverride, FeePricingWire, GasPrice } from '../../protocol/send';

/** Advanced's settings and pricing cross the message boundary as decimal strings. */
export function pricingToWire(p: FeePricing): FeePricingWire {
  return {
    native: p.native,
    nativePrice: { num: p.nativePrice.num.toString(), den: p.nativePrice.den.toString() },
    rate: { num: p.rate.num.toString(), den: p.rate.den.toString() },
  };
}

export function pricingFromWire(w: FeePricingWire): FeePricing {
  return {
    native: w.native,
    nativePrice: { num: BigInt(w.nativePrice.num), den: BigInt(w.nativePrice.den) },
    rate: { num: BigInt(w.rate.num), den: BigInt(w.rate.den) },
  };
}

export function multiplierOf(price: GasPrice): GasPriceMultiplier {
  return BigInt(price) as GasPriceMultiplier;
}

const GAS_LIMIT = /^[1-9]\d{0,17}$/;

/** A request's `override`, checked: a plain positive gas limit and a price of 1, 2 or 3. */
export function validOverride(x: unknown): FeeOverride | null {
  if (typeof x !== 'object' || x === null) return null;
  const { gasLimit, gasPrice } = x as Record<string, unknown>;
  if (typeof gasLimit !== 'string' || !GAS_LIMIT.test(gasLimit)) return null;
  if (gasPrice !== 1 && gasPrice !== 2 && gasPrice !== 3) return null;
  return { gasLimit, gasPrice };
}
