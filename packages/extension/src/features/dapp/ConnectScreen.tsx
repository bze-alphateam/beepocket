import { shortAddress } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { WalletErrorCodes, type ListedToken, type RequestView } from '../../protocol';
import { applyTheme } from '../../theme';
import { Banner, Button } from '../../ui';
import { useBalances } from '../home/data';
import { useHomeEnv } from '../home/env';
import { amountText } from '../home/format';
import { PasswordGate } from '../lock/PasswordGate';

type ConnectView = Extract<RequestView, { status: 'connect' }>;

export interface ConnectScreenProps {
  view: ConnectView;
  /** The request was answered (or may be): ask the worker what is next. */
  done: () => void;
}

/** The theme and balances come from the selected token: the first preferred one. */
function useFirstToken(): ListedToken | null {
  const client = useClient();
  const env = useHomeEnv();
  const [token, setToken] = useState<ListedToken | null>(null);

  useEffect(() => {
    const run = { live: true };
    const stale = () => !run.live;
    void (async () => {
      const [list, ctx] = await Promise.all([
        client.call('tokens.preferred', {}),
        client.call('home.context', {}),
      ]);
      // A wallet that never opened its home screen has no picks yet: BZE is the default.
      const first = list.ok
        ? (list.value[0] ??
          (await client
            .call('tokens.lookup', { code: 'ubze' })
            .then((r) => (r.ok ? r.value : undefined))))
        : undefined;
      if (stale() || !first) return;
      const brandThemes = ctx.ok ? ctx.value.brandThemes : true;
      const kit = brandThemes ? await client.call('tokens.theme', { denom: first.denom }) : null;
      if (stale()) return;
      applyTheme(env.themeTarget, {
        denom: first.denom,
        branding: kit?.ok ? kit.value : null,
        brandThemes,
        scheme: env.scheme.current(),
      });
      setToken(first);
    })();
    return () => {
      run.live = false;
    };
  }, [client, env]);
  return token;
}

/** Canvas `Connect`: the site, "exactly one address", the picker, Cancel and Connect. */
export function ConnectScreen({ view, done }: ConnectScreenProps) {
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
      done();
    } else if (res.error.code === WalletErrorCodes.needsPassword) {
      setNeedsPassword(true);
    } else if (res.error.code === 'unknown-request') {
      done();
    } else {
      setFailed(true);
    }
  };

  const balanceOf = (addressIndex: number): string => {
    const found = balances?.addresses.find((a) => a.index === addressIndex);
    if (!token || !found) return '…';
    return found.failed === true
      ? t('dapp.connect.unavailable')
      : `${amountText(found.amount, token.decimals)} ${token.symbol}`;
  };

  return (
    <Layout>
      <main class="bp-dapp">
        <h1>{t('dapp.connect.title')}</h1>
        <dl class="bp-dapp-facts">
          <dt>{t('dapp.connect.site')}</dt>
          <dd class="bp-dapp-origin">{view.origin}</dd>
          <dt>{t('dapp.connect.network')}</dt>
          <dd>{view.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</dd>
        </dl>
        <p class="bp-dapp-sub">{t('dapp.connect.sees')}</p>
        <fieldset class="bp-dapp-picker">
          <legend>{t('dapp.connect.pick')}</legend>
          {view.addresses.map((a) => (
            <label key={a.index} class="bp-dapp-option">
              <input
                type="radio"
                name="address"
                checked={a.index === index}
                disabled={busy}
                onChange={() => {
                  setIndex(a.index);
                }}
              />
              <span class="bp-dapp-label">{a.label}</span>
              <span class="bp-dapp-short">{shortAddress(a.address)}</span>
              <span class="bp-dapp-amount">{balanceOf(a.index)}</span>
            </label>
          ))}
        </fieldset>
        {failed && <Banner tone="red">{t('dapp.connect.failed')}</Banner>}
        {needsPassword ? (
          <>
            <p class="bp-dapp-sub">{t('dapp.connect.unlockHint')}</p>
            <PasswordGate
              submitLabel={t('dapp.connect.unlock')}
              onUnlocked={() => {
                setNeedsPassword(false);
                void answer(true);
              }}
            />
          </>
        ) : (
          <div class="bp-dapp-actions">
            <Button
              variant="quiet"
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
          </div>
        )}
      </main>
    </Layout>
  );
}
