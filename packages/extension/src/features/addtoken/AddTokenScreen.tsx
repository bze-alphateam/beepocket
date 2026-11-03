import { useCallback, useEffect, useState } from 'preact/hooks';
import { NETWORKS, type DenomBranding, type NetworkId } from '@beepocket/core';
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
import {
  Avatar,
  Banner,
  BottomActions,
  Button,
  CheckList,
  CopyButton,
  DappHeader,
  RiskBox,
  SiteCard,
  Spinner,
} from '../../ui';
import { useTokenTheme } from '../dapp/theme';
import { useHomeEnv } from '../home/env';
import { tokenColor } from '../home/format';
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
        link: { host: link.host, known: link.known },
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

const NATIVE_SYMBOL = 'BZE';

type Lookup =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unknown' }
  | {
      status: 'found';
      token: ListedToken;
      preferred: boolean;
      lookalike: boolean;
      branding: DenomBranding | null;
      brandThemes: boolean;
    };

/** The same symbol as the native token or a token already held, under a different code. */
function looksLikeAnother(token: ListedToken, held: ListedToken[]): boolean {
  const symbol = token.symbol.toUpperCase();
  if (token.kind !== 'native' && symbol === NATIVE_SYMBOL) return true;
  return held.some((x) => x.denom !== token.denom && x.symbol.toUpperCase() === symbol);
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
  const [network, setNetwork] = useState<NetworkId | null>(null);

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
      // The header's chain pill follows the wallet's network, whatever the lookup says.
      if (context.ok) setNetwork(context.value.network);
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
      setLookup({
        status: 'found',
        token: found.value,
        preferred: preferred.value.some((x) => x.denom === found.value.denom),
        lookalike: looksLikeAnother(found.value, preferred.value),
        branding,
        brandThemes,
      });
    })();
    return () => {
      run.live = false;
    };
  }, [client, link.code, attempt]);
  const found = lookup.status === 'found' ? lookup : null;
  useTokenTheme(found?.token.denom ?? null, found?.branding ?? null, found?.brandThemes ?? true);

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

  const header = (
    <DappHeader
      title={t('addtoken.title')}
      chainId={network === null ? undefined : NETWORKS[network].chainId}
    />
  );
  const footer =
    found === null ? undefined : (
      <BottomActions row>
        <Button variant="secondary" onClick={finish}>
          {t('addtoken.cancel')}
        </Button>
        <Button disabled={busy} onClick={() => void choose(found.token, found.preferred)}>
          {found.preferred
            ? t('addtoken.open', { symbol: found.token.symbol })
            : busy
              ? t('addtoken.adding')
              : t('addtoken.add', { symbol: found.token.symbol })}
        </Button>
      </BottomActions>
    );

  return (
    <Layout header={header} footer={footer}>
      <main class="bp-dapp bp-add">
        {link.host === null ? (
          <p class="bp-add-from">{t('addtoken.siteUnknown')}</p>
        ) : (
          <SiteCard origin={link.host} aside={t('addtoken.sentYou')} />
        )}
        {!link.known && <RiskBox tone="amber">{t('addtoken.unknown')}</RiskBox>}
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
            <Button variant="secondary" onClick={finish}>
              {t('addtoken.close')}
            </Button>
          </>
        )}
        {lookup.status === 'unknown' && (
          <>
            <Banner tone="red">{t('addtoken.noSuchToken')}</Banner>
            <Button variant="secondary" onClick={finish}>
              {t('addtoken.close')}
            </Button>
          </>
        )}
        {found !== null && (
          <>
            <section class="bp-add-token" data-denom={found.token.denom}>
              <Avatar label={found.token.symbol} color={tokenColor(found.token)} size={56} />
              <strong class="bp-add-symbol">{found.token.symbol}</strong>
              <span class="bp-add-name">{found.token.name}</span>
              <span class="bp-add-code">
                <span class="bp-mono">{link.code}</span>
                <CopyButton label={t('addtoken.copy')} copied={copied} onCopy={copy} />
              </span>
            </section>
            {found.lookalike && (
              <RiskBox tone="amber">
                {t('addtoken.lookalike', { symbol: found.token.symbol })}
              </RiskBox>
            )}
            <CheckList
              items={[
                found.preferred
                  ? t('addtoken.list.already', { symbol: found.token.symbol })
                  : t('addtoken.list.add'),
                t('addtoken.list.switch', { symbol: found.token.symbol }),
                t('addtoken.list.private'),
              ]}
            />
            {failed && <Banner tone="red">{t('addtoken.failed')}</Banner>}
          </>
        )}
      </main>
    </Layout>
  );
}
