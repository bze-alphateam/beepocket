import {
  GAS_PRICE_MULTIPLIERS,
  feeAt,
  formatAmount,
  gasLimitBounds,
  priceGasOverride,
  quickGasLimits,
  type FeePricing,
  type GasLimitBounds,
  type GasOverrideStatus,
  type QuickGasPick,
} from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { FeeChoice, FeeOverride, GasPrice, SendQuote } from '../../protocol/send';
import { Avatar, Button, Field, FieldSuffix, Icon } from '../../ui';
import { exact } from './format';
import { multiplierOf, pricingFromWire } from './override';

const PRICES = GAS_PRICE_MULTIPLIERS.map((m) => Number(m) as GasPrice);
const MAX_DIGITS = 18;

/** What a fee option becomes under Advanced settings, for the screens that show it. */
export interface AppliedFee {
  /** The option, or its fee and gas limit under the settings. */
  fee: FeeChoice;
  /** The gas limit is not the option's own. */
  customGas: boolean;
  gasPrice: GasPrice;
  /** `site`: the site's own fee untouched, with less gas than the simulation used. */
  status: GasOverrideStatus | 'site';
  bounds: GasLimitBounds | null;
}

/** The pricing an option carries, when Advanced can price it. */
export function pricingOf(option: FeeChoice): FeePricing | null {
  return option.pricing ? pricingFromWire(option.pricing) : null;
}

/**
 * `option` (as the fee sheet lists it, with its own gas limit and simulated gas) under
 * `override`. `spendable` is what the fee may take of its token. Without settings it is the
 * option itself.
 */
export function applyOverride(
  option: FeeChoice,
  override: FeeOverride | null,
  spendable: bigint,
): AppliedFee {
  const pricing = pricingOf(option);
  const gasUsed = BigInt(option.gasUsed);
  const bounds = pricing ? gasLimitBounds(gasUsed) : null;
  if (!override || !pricing) {
    // The site's own fee keeps the site-fee warnings (Business Logic §8), never a refusal.
    const status = option.setBy !== undefined && BigInt(option.gasLimit) < gasUsed ? 'site' : 'ok';
    return { fee: option, customGas: false, gasPrice: 1, status, bounds };
  }
  const priced = priceGasOverride({
    pricing,
    gasUsed,
    gasLimit: BigInt(override.gasLimit),
    gasPrice: multiplierOf(override.gasPrice),
    spendable,
  });
  // A new price keeps the site's gas limit the site's: the site simulated with its own margin,
  // so being under the wallet's estimate is no reason to warn (docs/fees.md §5).
  const siteGas = option.setBy !== undefined && override.gasLimit === option.gasLimit;
  return {
    fee: { ...option, amount: priced.amount.toString(), gasLimit: override.gasLimit },
    customGas: override.gasLimit !== option.gasLimit,
    gasPrice: override.gasPrice,
    status: siteGas && priced.status === 'warn' ? 'ok' : priced.status,
    bounds: priced.bounds,
  };
}

/** What Review and the form show of a quote's Advanced settings; null when it has none. */
export interface QuoteAdvanced {
  /** The gas limit is not the estimate: Review shows it. */
  customGas: boolean;
  gasLimit: string;
  /** The wallet's estimate for the fee token. */
  estimate: string;
  gasPrice: GasPrice;
  /** `0.02`, the price in ubze per gas. */
  price: string;
  /** Below the estimate: the transaction may run out of gas. */
  warn: boolean;
}

export function quoteAdvanced(quote: SendQuote): QuoteAdvanced | null {
  const { override } = quote;
  // The options keep their own fees: the picked one's gas limit is the estimate.
  const own = quote.options.find((o) => o.denom === quote.fee.denom && o.setBy === undefined);
  const pricing = own ? pricingOf(own) : null;
  if (!override || !own || !pricing) return null;
  return {
    customGas: override.gasLimit !== own.gasLimit,
    gasLimit: override.gasLimit,
    estimate: own.gasLimit,
    gasPrice: override.gasPrice,
    price: priceText(pricing, override.gasPrice),
    warn: BigInt(override.gasLimit) < BigInt(own.gasLimit),
  };
}

/** Digits a gas price whose fraction does not end in a power of ten is shown with. */
const PRICE_DIGITS = 18;

/**
 * `0.01` for the chain minimum: the native price in base units per gas, times `times`. The
 * chain's price is a decimal string, so its denominator is a power of ten and this is exact;
 * any other fraction is shown to 18 digits, rounded up, in integer math.
 */
export function priceText(pricing: FeePricing, times: GasPrice): string {
  const { num, den } = pricing.nativePrice;
  const scaled = num * BigInt(times);
  const decimals = den.toString().length - 1;
  if (den === 10n ** BigInt(decimals)) {
    return formatAmount(scaled, decimals, { maxFraction: decimals });
  }
  const unit = 10n ** BigInt(PRICE_DIGITS);
  const up = (scaled * unit + den - 1n) / den;
  return formatAmount(up, PRICE_DIGITS, { maxFraction: PRICE_DIGITS });
}

const pickLabel = (pick: QuickGasPick): string =>
  pick === 'auto'
    ? t('send.gas.pick.auto')
    : pick === 'max'
      ? t('send.gas.pick.max')
      : pick.replace('x', '×');

export interface AdvancedProps {
  /** The picked fee option as the sheet lists it: its own gas limit, fee and simulated gas. */
  option: FeeChoice;
  /** The settings in force, null for none. */
  applied: FeeOverride | null;
  /** A gas limit to start from instead ("Raise gas"). */
  prefill?: string | undefined;
  /** What the fee may take of its token. */
  spendable: bigint;
  /** The paying address's label, for "Main holds too little". */
  holder: string;
  /** Done: the settings, or null when they are the option's own again. */
  onDone: (override: FeeOverride | null) => void;
  /** Back to the token list. */
  onChange: () => void;
}

/**
 * The fee sheet's Advanced step: the gas limit (typed or a quick pick) and the gas price (the
 * chain minimum, ×2 or ×3), with the fee live. Below the minimum, above the maximum or above
 * the balance it is refused and Done is off; below the estimate it warns.
 */
export function Advanced(props: AdvancedProps) {
  const { option } = props;
  const gasUsed = BigInt(option.gasUsed);
  const pricing = pricingOf(option);
  const own = option.gasLimit;
  const [text, setText] = useState(props.prefill ?? props.applied?.gasLimit ?? own);
  const [price, setPrice] = useState<GasPrice>(props.applied?.gasPrice ?? 1);
  if (!pricing) return null;
  const site = option.setBy;
  const untouched = text === own && price === 1;
  const draft: FeeOverride | null =
    text === '' || untouched ? null : { gasLimit: text, gasPrice: price };
  const applied = applyOverride(option, draft, props.spendable);
  const bounds = applied.bounds ?? gasLimitBounds(gasUsed);
  const status = text === '' ? 'empty' : applied.status;
  const refused =
    status === 'empty' || status === 'low' || status === 'high' || status === 'afford';
  const fmt = (n: bigint) => formatAmount(n, 0);
  const help =
    status === 'empty'
      ? t('send.gas.empty')
      : status === 'low'
        ? t('send.gas.low', { min: fmt(bounds.min) })
        : status === 'high'
          ? t('send.gas.high', { max: fmt(bounds.max) })
          : status === 'afford'
            ? t('send.gas.afford', {
                label: props.holder,
                amount: exact(props.spendable.toString(), option.decimals),
                symbol: option.symbol,
              })
            : status === 'site' && site !== undefined
              ? t('send.gas.siteLow', { site, gas: fmt(BigInt(own)), used: fmt(gasUsed) })
              : status === 'warn'
                ? t('send.gas.warn', { estimate: fmt(bounds.estimate) })
                : site !== undefined && text === own
                  ? t('send.gas.help.site', { site, estimate: fmt(bounds.estimate) })
                  : t('send.gas.help', { estimate: fmt(bounds.estimate), used: fmt(gasUsed) });
  const tone = refused ? 'bad' : status === 'warn' || status === 'site' ? 'warn' : 'plain';
  const fee =
    refused && status !== 'afford'
      ? t('send.fee.none')
      : `≈ ${exact(applied.fee.amount, option.decimals)} ${option.symbol}`;
  const multiplier = multiplierOf(price);
  const copy =
    site !== undefined && !untouched
      ? t('send.gas.copy.site', { site })
      : price === 1
        ? t('send.gas.copy')
        : t('send.gas.copy.price');

  return (
    <div class="bp-gas">
      <div class="bp-gas-token">
        <Avatar label={option.symbol} src={option.logo} size={26} />
        <span class="bp-gas-token-text">
          <strong>{t('send.gas.paidIn', { symbol: option.symbol })}</strong>
          <span>
            {site !== undefined
              ? t('send.gas.paidIn.site', { site })
              : t('send.gas.paidIn.balance', {
                  amount: exact(option.balance ?? props.spendable.toString(), option.decimals),
                  symbol: option.symbol,
                })}
          </span>
        </span>
        <Button variant="ghost" onClick={props.onChange}>
          {t('send.gas.change')}
        </Button>
      </div>
      <div class={`bp-gas-limit bp-gas-${tone}`}>
        {site !== undefined && text !== own && (
          <Button
            variant="ghost"
            class="bp-gas-reset"
            onClick={() => {
              setText(own);
              setPrice(1);
            }}
          >
            {t('send.gas.useSite', { gas: fmt(BigInt(own)) })}
          </Button>
        )}
        <Field
          label={t('send.gas.limit')}
          mono
          inputMode="numeric"
          value={text === '' ? '' : fmt(BigInt(text))}
          onInput={(v) => {
            setText(v.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS));
          }}
          error={refused ? help : undefined}
          hint={refused || tone === 'warn' ? undefined : help}
          trailing={<FieldSuffix>gas</FieldSuffix>}
        />
        {tone === 'warn' && (
          <p class="bp-gas-note" role="status">
            <Icon name="alert-triangle" size={14} />
            <span>{help}</span>
          </p>
        )}
      </div>
      <div class="bp-gas-picks" role="group" aria-label={t('send.gas.quick')}>
        {quickGasLimits(bounds).map(({ pick, gasLimit }) => {
          const off = feeAt(pricing, gasLimit, multiplier) > props.spendable;
          const gas = fmt(gasLimit);
          return (
            <Button
              key={pick}
              variant="chip"
              class="bp-gas-pick"
              pressed={text === gasLimit.toString()}
              disabled={off}
              label={
                pick === 'auto'
                  ? t('send.gas.pick.auto.label', { gas })
                  : t(off ? 'send.gas.pick.label.off' : 'send.gas.pick.label', {
                      pick: pickLabel(pick),
                      gas,
                    })
              }
              onClick={() => {
                setText(gasLimit.toString());
              }}
            >
              {pickLabel(pick)}
            </Button>
          );
        })}
      </div>
      <div class="bp-gas-price-head">
        <span id="bp-gas-price">{t('send.gas.price')}</span>
        <span>
          {t(price === 1 ? 'send.gas.price.min' : 'send.gas.price.text', {
            price: priceText(pricing, price),
          })}
        </span>
      </div>
      <div class="bp-gas-picks bp-gas-prices" role="radiogroup" aria-labelledby="bp-gas-price">
        {PRICES.map((p) => {
          const label =
            p === 1 ? t('send.gas.price.pick.min') : t('send.gas.price.pick', { times: p });
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={price === p}
              aria-label={t('send.gas.price.label', { pick: label, price: priceText(pricing, p) })}
              class="bp-btn bp-btn-chip bp-gas-pick"
              onClick={() => {
                setPrice(p);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div class="bp-gas-fee">
        <span>{t('send.gas.fee')}</span>
        <Avatar label={option.symbol} src={option.logo} size={18} />
        <strong aria-live="polite">{fee}</strong>
      </div>
      <p class="bp-gas-copy">{copy}</p>
      <Button
        disabled={refused}
        onClick={() => {
          props.onDone(draft);
        }}
      >
        {t('send.gas.done')}
      </Button>
    </div>
  );
}
