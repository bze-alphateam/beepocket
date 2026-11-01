import { shortAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { AddressBalance, TokenBalances, WalletAddress } from '../../protocol';
import { amountText, holds } from './format';

export interface AddressesTabProps {
  decimals: number;
  symbol: string;
  balances: TokenBalances | null;
  addresses: WalletAddress[];
  onCopy: (address: string) => void;
  onRename: (address: WalletAddress) => void;
  onAdd: () => void;
}

/** Addresses holding the token; empty ones fold away unless nobody holds it. */
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

  return (
    <div class="bp-home-addresses">
      <ul>
        {visible.map(({ address, balance }) => (
          <li key={address.index} class="bp-home-row">
            <button
              type="button"
              class="bp-home-label"
              aria-label={t('home.address.rename', { label: address.label })}
              onClick={() => {
                props.onRename(address);
              }}
            >
              {address.label}
            </button>
            <span class="bp-home-short">{shortAddress(address.address)}</span>
            <button
              type="button"
              class="bp-home-icon"
              aria-label={t('home.address.copy', { label: address.label })}
              onClick={() => {
                props.onCopy(address.address);
              }}
            >
              ⧉
            </button>
            <span class="bp-home-amount">
              {balance === undefined
                ? '…'
                : balance.failed === true
                  ? t('home.address.unavailable')
                  : amountText(balance.amount, props.decimals)}
            </span>
          </li>
        ))}
      </ul>
      {folding && (
        <button
          type="button"
          class="bp-home-link"
          onClick={() => {
            setShowEmpty(!showEmpty);
          }}
        >
          {showEmpty
            ? t('home.address.hideEmpty')
            : empty.length === 1
              ? t('home.address.showEmpty.one')
              : t('home.address.showEmpty', { count: empty.length })}
        </button>
      )}
      <button type="button" class="bp-home-link" onClick={props.onAdd}>
        + {t('home.address.add')}
      </button>
    </div>
  );
}

const byIdx = (a: { address: WalletAddress }, b: { address: WalletAddress }) =>
  a.address.index - b.address.index;
