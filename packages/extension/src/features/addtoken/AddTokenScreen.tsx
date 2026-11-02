import { useCallback, useEffect, useState } from 'preact/hooks';
import type { DenomBranding } from '@beepocket/core';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import {
  TokenErrorCodes,
  type AddTokenView,
  type ListedToken,
  type WalletState,
} from '../../protocol';
import { applyTheme } from '../../theme';
import { Banner, Button, Spinner } from '../../ui';
import { useHomeEnv } from '../home/env';
import type { HomeRoute } from '../home/Home';
import { UnlockPanel } from '../lock/UnlockScreen';
import type { OnboardingRoute } from '../onboarding/routes';

export interface AddTokenScreenProps {
  /** Closes the window (`window.close()`). */
  close: () => void;
}

type Link = Extract<AddTokenView, { status: 'link' }>;
type Load =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'locked'; link: Link }
  | { status: 'ready'; link: Link };

/**
 * The window of an add-a-token link. The worker decides what waits; this screen follows the
 * wallet: unlock first when fully locked, onboarding when no wallet exists yet.
 */
export function AddTokenScreen({ close }: AddTokenScreenProps) {
  const client = useClient();
  const { navigate } = useRoute<HomeRoute | OnboardingRoute | { name: 'lock.root' }>();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const start = useCallback(async () => {
    const view = await client.call('addtoken.current', {});
    if (!view.ok) {
      setLoad({ status: 'failed' });
      return;
    }
    if (view.value.status === 'none') {
      navigate({ name: 'lock.root' });
      return;
    }
    const link = view.value;
    const state = await client.call('wallet.state', {});
    if (!state.ok) {
      setLoad({ status: 'failed' });
      return;
    }
    const wallet: WalletState = state.value.state;
    if (link.source === 'install' || wallet === 'uninitialised') {
      navigate({
        name: 'onboarding.welcome',
        prefillCode: link.code,
        link: { host: link.host ?? 'getbze.com', known: link.known },
      });
      return;
    }
    setLoad({ status: wallet === 'locked' ? 'locked' : 'ready', link });
  }, [client, navigate]);

  useEffect(() => {
    void start();
  }, [start]);

  if (load.status === 'loading') {
    return (
      <Layout>
        <div class="bp-dapp-center">
          <Spinner />
        </div>
      </Layout>
    );
  }
  if (load.status === 'failed') {
    return (
      <Layout>
        <div class="bp-dapp-center">
          <Banner tone="red">{t('addtoken.loadFailed')}</Banner>
          <Button
            onClick={() => {
              setLoad({ status: 'loading' });
              void start();
            }}
          >
            {t('addtoken.retry')}
          </Button>
        </div>
      </Layout>
    );
  }
  if (load.status === 'locked') {
    return <UnlockPanel noImport subtitle={t('addtoken.locked')} onUnlocked={() => void start()} />;
  }
  return <AddCard link={load.link} close={close} />;
}

type Lookup =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unknown' }
  | { status: 'found'; token: ListedToken; preferred: boolean; branding: DenomBranding | null };

/** `factory/bze1…/gold` becomes `factory/bze1abc…/gold`: enough to recognise, short enough to fit. */
export function shortCode(code: string): string {
  const max = 28;
  return code.length <= max ? code : `${code.slice(0, 16)}…${code.slice(-9)}`;
}

function AddCard({ link, close }: { link: Link; close: () => void }) {
  const client = useClient();
  const env = useHomeEnv();
  const { navigate } = useRoute<HomeRoute>();
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const run = { live: true };
    setLookup({ status: 'loading' });
    void (async () => {
      const [found, preferred, context] = await Promise.all([
        client.call('tokens.lookup', { code: link.code }),
        client.call('tokens.preferred', {}),
        client.call('home.context', {}),
      ]);
      if (!run.live) return;
      if (!found.ok) {
        const code = found.error.code;
        const unknown =
          code === TokenErrorCodes.noSuchToken || code === TokenErrorCodes.invalidCode;
        setLookup({ status: unknown ? 'unknown' : 'failed' });
        return;
      }
      if (!preferred.ok || !context.ok) {
        setLookup({ status: 'failed' });
        return;
      }
      const brandThemes = context.value.brandThemes;
      const branding = brandThemes ? found.value.branding : null;
      applyTheme(env.themeTarget, {
        denom: found.value.denom,
        branding,
        brandThemes,
        scheme: env.scheme.current(),
      });
      setLookup({
        status: 'found',
        token: found.value,
        preferred: preferred.value.some((x) => x.denom === found.value.denom),
        branding,
      });
    })();
    return () => {
      run.live = false;
    };
  }, [client, env, link.code, attempt]);

  const finish = () => {
    void client.call('addtoken.clear', {}).finally(close);
  };
  const choose = async (token: ListedToken, preferred: boolean) => {
    setBusy(true);
    setFailed(false);
    if (!preferred) {
      const res = await client.call('tokens.add', { denom: token.denom });
      if (!res.ok) {
        setBusy(false);
        setFailed(true);
        return;
      }
    }
    await client.call('addtoken.clear', {});
    navigate({
      name: 'home.main',
      denom: token.denom,
      ...(preferred ? {} : { toast: t('addtoken.added', { symbol: token.symbol }) }),
    });
  };
  const copy = () => {
    env.clipboard.writeText(link.code).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };

  return (
    <Layout>
      <main class="bp-dapp bp-add">
        <h1>{t('addtoken.title')}</h1>
        <p class="bp-dapp-sub">
          {link.host === null ? t('addtoken.siteUnknown') : t('addtoken.site', { site: link.host })}
        </p>
        {lookup.status === 'loading' && (
          <div class="bp-dapp-center">
            <Spinner />
          </div>
        )}
        {lookup.status === 'failed' && (
          <>
            <Banner tone="red">{t('addtoken.loadFailed')}</Banner>
            <Button
              onClick={() => {
                setAttempt((n) => n + 1);
              }}
            >
              {t('addtoken.retry')}
            </Button>
            <Button variant="quiet" onClick={finish}>
              {t('addtoken.close')}
            </Button>
          </>
        )}
        {lookup.status === 'unknown' && (
          <>
            <Banner tone="red">{t('addtoken.noSuchToken')}</Banner>
            <Button variant="quiet" onClick={finish}>
              {t('addtoken.close')}
            </Button>
          </>
        )}
        {lookup.status === 'found' && (
          <>
            <section class="bp-add-token" data-denom={lookup.token.denom}>
              <b>{lookup.token.symbol}</b> · {lookup.token.name}
              <dl class="bp-dapp-facts">
                <dt>{t('addtoken.code')}</dt>
                <dd class="bp-dapp-origin" title={link.code}>
                  {shortCode(link.code)}{' '}
                  <button type="button" class="bp-add-copy" onClick={copy}>
                    {copied ? t('addtoken.copied') : t('addtoken.copy')}
                  </button>
                </dd>
              </dl>
            </section>
            <p class="bp-dapp-sub">{t('addtoken.what')}</p>
            {!link.known && <Banner tone="amber">{t('addtoken.unknown')}</Banner>}
            {failed && <Banner tone="red">{t('addtoken.failed')}</Banner>}
            <div class="bp-add-actions">
              <Button variant="quiet" onClick={finish}>
                {t('addtoken.cancel')}
              </Button>
              <Button disabled={busy} onClick={() => void choose(lookup.token, lookup.preferred)}>
                {lookup.preferred
                  ? t('addtoken.open', { symbol: lookup.token.symbol })
                  : busy
                    ? t('addtoken.adding')
                    : t('addtoken.add', { symbol: lookup.token.symbol })}
              </Button>
            </div>
          </>
        )}
      </main>
    </Layout>
  );
}
