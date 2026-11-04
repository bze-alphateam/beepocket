import { formatAmount, shortAddress } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { WalletAddress } from '../../protocol';
import type { FeeChoice, FeeOverride } from '../../protocol/send';
import { Avatar, Icon, ListRow, Sheet } from '../../ui';
import { Advanced, applyOverride, pricingOf } from './Advanced';
import { shortDenom } from '../activity/format';
import { exact } from './format';

export interface FromRow {
  address: WalletAddress;
  /** Base units of the sent token. */
  balance: bigint;
}

/** `W-From`: every address with its balance; the empty ones cannot be picked. */
export function FromSheet(props: {
  open: boolean;
  rows: FromRow[];
  selected: number;
  decimals: number;
  symbol: string;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={props.open} title={t('send.from.pick')} onClose={props.onClose}>
      <div class="bp-send-options">
        {props.rows.map(({ address, balance }) => {
          const amount = `${exact(balance.toString(), props.decimals)} ${props.symbol}`;
          return (
            <ListRow
              key={address.index}
              size="option"
              title={address.label}
              subtitle={shortAddress(address.address)}
              value={amount}
              selected={address.index === props.selected}
              disabled={balance === 0n}
              label={t('send.from.option', { label: address.label, amount })}
              onClick={() => {
                props.onPick(address.index);
              }}
            />
          );
        })}
        <p class="bp-send-sheet-note">{t('send.from.empty', { symbol: props.symbol })}</p>
      </div>
    </Sheet>
  );
}

/**
 * Which fee option a choice is: its denom for the wallet's own options, set apart for the one a
 * site set, which can be in the same token.
 */
export const feeKey = (o: FeeChoice): string =>
  o.setBy === undefined ? o.denom : `site:${o.denom}`;

/** The fee sheet's Advanced step, for the picked option. */
export interface FeeSheetAdvanced {
  /** What the simulation used. */
  gasUsed: bigint;
  /** The settings in force for the picked option, null for none. */
  applied: FeeOverride | null;
  /** What the fee may take of a token (its balance, less a sent amount in it). */
  spendable: (option: FeeChoice) => bigint;
  /** The paying address's label. */
  holder: string;
  /** Done on the Advanced step. */
  onApply: (override: FeeOverride | null) => void;
  /** Open on the Advanced step, with this gas limit ("Raise gas"). */
  prefill?: string | undefined;
}

/**
 * `W-Fee`: every token this address can pay the fee with; choosing one re-prices the send and
 * drops any Advanced settings. With `advanced`, the last row opens the Advanced step (gas limit
 * and price) for the picked option. `selected` and `onPick` speak `feeKey`.
 */
export function FeeSheet(props: {
  open: boolean;
  options: FeeChoice[];
  selected: string;
  onPick: (key: string) => void;
  onClose: () => void;
  advanced?: FeeSheetAdvanced | undefined;
}) {
  const { advanced } = props;
  const [step, setStep] = useState<'list' | 'advanced'>('list');
  const prefill = advanced?.prefill;
  useEffect(() => {
    setStep(props.open && prefill !== undefined ? 'advanced' : 'list');
  }, [props.open, prefill]);
  const picked = props.options.find((o) => feeKey(o) === props.selected);
  const canAdvance = advanced !== undefined && picked !== undefined && pricingOf(picked) !== null;
  const shown =
    picked && advanced
      ? applyOverride(picked, advanced.gasUsed, advanced.applied, advanced.spendable(picked))
      : null;

  if (step === 'advanced' && canAdvance) {
    return (
      <Sheet
        open={props.open}
        title={t('send.gas.advanced')}
        onClose={props.onClose}
        onBack={() => {
          setStep('list');
        }}
      >
        <Advanced
          key={`${feeKey(picked)}:${prefill ?? ''}`}
          option={picked}
          gasUsed={advanced.gasUsed}
          applied={advanced.applied}
          prefill={prefill}
          spendable={advanced.spendable(picked)}
          holder={advanced.holder}
          onDone={(o) => {
            advanced.onApply(o);
          }}
          onChange={() => {
            setStep('list');
          }}
        />
      </Sheet>
    );
  }
  const gas = shown ? formatAmount(BigInt(shown.fee.gasLimit), 0) : '';
  const custom = advanced !== undefined && advanced.applied !== null;
  return (
    <Sheet open={props.open} title={t('send.fee.title')} onClose={props.onClose}>
      <div class="bp-send-options">
        {props.options.map((o) => {
          const key = feeKey(o);
          const on = key === props.selected;
          const amount = on && shown ? shown.fee.amount : o.amount;
          const fee = `≈ ${exact(amount, o.decimals)} ${o.symbol}`;
          return (
            <ListRow
              key={key}
              size="option"
              title={o.symbol}
              plainSubtitle
              subtitle={
                o.setBy !== undefined
                  ? // The denom and gas limit too: a site's token can borrow a known symbol.
                    t('send.fee.setBy', {
                      site: o.setBy,
                      denom: shortDenom(o.denom),
                      gas: formatAmount(BigInt(o.gasLimit), 0),
                    })
                  : o.balance === undefined
                    ? undefined
                    : t('send.fee.balance', { amount: exact(o.balance, o.decimals) })
              }
              leading={<Avatar label={o.symbol} src={o.logo} size={30} />}
              value={fee}
              unit={on ? t(custom ? 'send.fee.custom' : 'send.fee.selected') : undefined}
              selected={on}
              label={t('send.fee.option', { symbol: o.symbol, fee })}
              onClick={() => {
                props.onPick(key);
              }}
            />
          );
        })}
        {canAdvance && (
          <button
            type="button"
            class="bp-gas-row"
            aria-label={t('send.gas.advanced.label', {
              hint: custom
                ? t('send.gas.hint.custom', { gas })
                : picked.setBy !== undefined
                  ? t('send.gas.hint.site', { gas })
                  : t('send.gas.hint', { gas }),
            })}
            onClick={() => {
              setStep('advanced');
            }}
          >
            <Icon name="sliders" size={16} />
            <span class="bp-gas-row-title">{t('send.gas.advanced')}</span>
            <span class={custom ? 'bp-gas-row-hint bp-gas-row-custom' : 'bp-gas-row-hint'}>
              {custom
                ? t('send.gas.hint.custom', { gas })
                : picked.setBy !== undefined
                  ? t('send.gas.hint.site', { gas })
                  : t('send.gas.hint', { gas })}
            </span>
            <Icon name="chevron-right" size={16} />
          </button>
        )}
      </div>
    </Sheet>
  );
}
