import { shortAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { WalletAddress } from '../../protocol';
import type { FeeChoice } from '../../protocol/send';
import { useClient } from '../../popup/client-context';
import { Banner, Button, Sheet, TextField } from '../../ui';
import { exact, feeText } from './format';

export interface FromRow {
  address: WalletAddress;
  /** Base units of the sent token. */
  balance: bigint;
}

/** `W-From`: the addresses that hold the token, with their balances. */
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
      <ul class="bp-send-list">
        {props.rows.map(({ address, balance }) => (
          <li key={address.index}>
            <button
              type="button"
              class="bp-send-row"
              aria-pressed={address.index === props.selected}
              disabled={balance === 0n}
              onClick={() => {
                props.onPick(address.index);
              }}
            >
              <span>
                <strong>{address.label}</strong>
                <small>{shortAddress(address.address)}</small>
              </span>
              <span>
                {exact(balance.toString(), props.decimals)} {props.symbol}
              </span>
            </button>
          </li>
        ))}
      </ul>
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
      <p class="bp-send-note">{t('send.fee.intro', { label: props.label })}</p>
      <ul class="bp-send-list">
        {props.options.map((o) => (
          <li key={o.denom}>
            <button
              type="button"
              class="bp-send-row"
              aria-pressed={o.denom === props.selected}
              onClick={() => {
                props.onPick(o.denom);
              }}
            >
              <strong>{o.symbol}</strong>
              <span>≈ {feeText(o)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** `W-Contact-New` from the Send form: the address is known, only the name is asked. */
export function SaveContactSheet(props: {
  open: boolean;
  address: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const client = useClient();
  const [name, setName] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void client.call('book.add', { name: name.trim(), address: props.address }).then((r) => {
      setBusy(false);
      if (r.ok) props.onSaved();
      else setFailed(true);
    });
  };
  return (
    <Sheet open={props.open} title={t('send.save.title')} onClose={props.onClose}>
      <form class="bp-send-form" onSubmit={submit}>
        <p class="bp-send-note bp-send-mono">{props.address}</p>
        <TextField label={t('send.save.name')} value={name} onInput={setName} autoFocus />
        {failed && <Banner tone="red">{t('send.save.failed')}</Banner>}
        <Button type="submit" disabled={busy || name.trim() === ''}>
          {t('send.save.confirm')}
        </Button>
      </form>
    </Sheet>
  );
}
