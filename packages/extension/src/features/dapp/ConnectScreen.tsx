import { NETWORKS, shortAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { WalletErrorCodes, type RequestView } from '../../protocol';
import {
  Banner,
  BottomActions,
  Button,
  CheckList,
  DappHeader,
  RadioList,
  SectionLabel,
  SiteCard,
} from '../../ui';
import { useBalances } from '../home/data';
import { amountText } from '../home/format';
import { PasswordGate } from '../lock/PasswordGate';
import { requestBadge, type Answer } from './answers';
import { useFirstToken } from './theme';

type ConnectView = Extract<RequestView, { status: 'connect' }>;

export interface ConnectScreenProps {
  view: ConnectView;
  /** The request was answered (or may be): ask the worker what is next. */
  done: (answer?: Answer) => void;
  /** Requests waiting in all, this one included; 2 or more shows "1 of N". */
  queue?: number | undefined;
}

/** Canvas `W-Connect`: the site, one address to pick, what the site gets, Cancel and Connect. */
export function ConnectScreen({ view, done, queue }: ConnectScreenProps) {
  const client = useClient();
  const token = useFirstToken();
  const { balances } = useBalances(token?.denom ?? null);
  const [index, setIndex] = useState(view.addresses[0]?.index ?? 0);
  const [busy, setBusy] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [failed, setFailed] = useState(false);

  const answer = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const res = await client.call('dapp.answer', { id: view.id, approve, index });
    setBusy(false);
    if (res.ok) {
      const label = view.addresses.find((a) => a.index === index)?.label ?? '';
      done({ kind: 'connect', approved: approve, origin: view.origin, label });
    } else if (res.error.code === WalletErrorCodes.needsPassword) {
      setNeedsPassword(true);
    } else if (res.error.code === 'unknown-request') {
      done();
    } else {
      setFailed(true);
    }
  };

  const balanceOf = (addressIndex: number): { text: string; empty: boolean } => {
    const found = balances?.addresses.find((a) => a.index === addressIndex);
    if (!token || !found) return { text: '…', empty: false };
    if (found.failed === true) return { text: t('dapp.connect.unavailable'), empty: true };
    return {
      text: `${amountText(found.amount, token.decimals)} ${token.symbol}`,
      empty: /^0*$/.test(found.amount),
    };
  };

  const actions = (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          void answer(false);
        }}
      >
        {t('dapp.connect.cancel')}
      </Button>
      <Button
        disabled={busy}
        onClick={() => {
          void answer(true);
        }}
      >
        {t('dapp.connect.connect')}
      </Button>
    </>
  );

  return (
    <Layout
      header={
        <DappHeader
          title={t('dapp.connect.title')}
          chainId={NETWORKS[view.network].chainId}
          badge={requestBadge(queue)}
        />
      }
      footer={needsPassword ? undefined : <BottomActions row>{actions}</BottomActions>}
    >
      <main class="bp-dapp">
        <SiteCard origin={view.origin} size="lg" />
        <SectionLabel title={t('dapp.connect.pick')} />
        <RadioList
          label={t('dapp.connect.pick')}
          value={index}
          disabled={busy}
          onChange={setIndex}
          options={view.addresses.map((a) => {
            const balance = balanceOf(a.index);
            return {
              value: a.index,
              title: a.label,
              subtitle: shortAddress(a.address),
              amount: balance.text,
              muted: balance.empty,
            };
          })}
        />
        <CheckList items={[t('dapp.connect.sees'), t('dapp.connect.asks')]} />
        {failed && <Banner tone="red">{t('dapp.connect.failed')}</Banner>}
        {needsPassword && (
          <>
            <p class="bp-dapp-sub">{t('dapp.connect.unlockHint')}</p>
            <PasswordGate
              submitLabel={t('dapp.connect.unlock')}
              labelIcon="lock"
              onUnlocked={() => {
                setNeedsPassword(false);
                void answer(true);
              }}
            />
          </>
        )}
      </main>
    </Layout>
  );
}
