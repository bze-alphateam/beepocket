import { shortAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { AddressBalance, TokenBalances, WalletAddress } from '../../protocol';
import { Button, CopyButton, ListRow } from '../../ui';
import { amountText, holds } from './format';

export interface AddressesTabProps {
  decimals: number;
  symbol: string;
  balances: TokenBalances | null;
  addresses: WalletAddress[];
  /** The address whose copy button shows the check right now. */
  copied: number | null;
  onCopy: (address: WalletAddress) => void;
  onRename: (address: WalletAddress) => void;
  /** A tap on the row: send the token from this address. */
  onSend: (address: WalletAddress) => void;
}

/** One card per address; empty ones fold behind one ghost button unless nobody holds the token. */
export function AddressesTab(props: AddressesTabProps) {
  const [showEmpty, setShowEmpty] = useState(false);
  const byIndex = new Map<number, AddressBalance>(
    (props.balances?.addresses ?? []).map((b) => [b.index, b]),
  );
  const rows = props.addresses.map((address) => ({ address, balance: byIndex.get(address.index) }));
  const isHeld = (r: (typeof rows)[number]) =>
    r.balance === undefined || r.balance.failed === true || holds(r.balance);
  const held = rows.filter(isHeld);
  const empty = rows.filter((r) => !isHeld(r));
  const folding = held.length > 0 && empty.length > 0;
  const visible = !folding || showEmpty ? [...held, ...empty].sort(byIdx) : held;
  const n = empty.length;
  const toggleText = showEmpty
    ? n === 1
      ? t('home.address.hideEmpty.one')
      : t('home.address.hideEmpty', { count: n })
    : n === 1
      ? t('home.address.showEmpty.one')
      : t('home.address.showEmpty', { count: n });

  return (
    <div class="bp-home-addresses">
      {visible.map(({ address, balance }) => (
        <ListRow
          key={address.index}
          title={address.label}
          subtitle={shortAddress(address.address)}
          label={t('home.address.send', { symbol: props.symbol, label: address.label })}
          onClick={() => {
            props.onSend(address);
          }}
          titleAction={
            <Button
              variant="icon"
              icon="pencil"
              iconSize={14}
              label={t('home.address.rename', { label: address.label })}
              onClick={() => {
                props.onRename(address);
              }}
            />
          }
          subtitleAction={
            <CopyButton
              label={t('home.address.copy', { label: address.label })}
              copied={props.copied === address.index}
              onCopy={() => {
                props.onCopy(address);
              }}
            />
          }
          value={
            balance === undefined
              ? '…'
              : balance.failed === true
                ? t('home.address.unavailable')
                : amountText(balance.amount, props.decimals)
          }
          unit={props.symbol}
          valueMuted={balance !== undefined && !holds(balance)}
          chevron
        />
      ))}
      {folding && (
        <Button
          variant="ghost"
          tone="muted"
          trailingIcon="chevron-down"
          class={showEmpty ? 'bp-home-fold bp-home-fold-open' : 'bp-home-fold'}
          expanded={showEmpty}
          onClick={() => {
            setShowEmpty(!showEmpty);
          }}
        >
          {toggleText}
        </Button>
      )}
    </div>
  );
}

const byIdx = (a: { address: WalletAddress }, b: { address: WalletAddress }) =>
  a.address.index - b.address.index;
