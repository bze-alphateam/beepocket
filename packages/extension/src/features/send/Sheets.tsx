import { shortAddress } from '@beepocket/core';
import { t } from '../../i18n';
import type { WalletAddress } from '../../protocol';
import type { FeeChoice } from '../../protocol/send';
import { Avatar, ListRow, Sheet } from '../../ui';
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

/** `W-Fee`: every token this address can pay the fee with. Choosing one re-prices the send. */
export function FeeSheet(props: {
  open: boolean;
  label: string;
  options: FeeChoice[];
  selected: string;
  onPick: (denom: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={props.open} title={t('send.fee.title')} onClose={props.onClose}>
      <div class="bp-send-options">
        <p class="bp-send-sheet-intro">{t('send.fee.intro', { label: props.label })}</p>
        {props.options.map((o) => {
          const on = o.denom === props.selected;
          const fee = `≈ ${exact(o.amount, o.decimals)} ${o.symbol}`;
          return (
            <ListRow
              key={o.denom}
              size="option"
              title={o.symbol}
              plainSubtitle
              subtitle={
                o.balance === undefined
                  ? undefined
                  : t('send.fee.balance', { amount: exact(o.balance, o.decimals) })
              }
              leading={<Avatar label={o.symbol} size={30} />}
              value={fee}
              unit={on ? t('send.fee.selected') : undefined}
              selected={on}
              label={t('send.fee.option', { symbol: o.symbol, fee })}
              onClick={() => {
                props.onPick(o.denom);
              }}
            />
          );
        })}
        <p class="bp-send-sheet-note">{t('send.fee.note')}</p>
      </div>
    </Sheet>
  );
}
