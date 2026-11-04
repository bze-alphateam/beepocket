import type { DenomBranding } from '@beepocket/core';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { WalletErrorCodes, type ListedToken, type WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { AppearanceToggle } from '../../popup/appearance';
import { Layout } from '../../popup/Layout';
import { useRoute } from '../../popup/router';
import { applyTheme } from '../../theme';
import {
  Banner,
  Button,
  Card,
  HomeHeader,
  Pill,
  Segmented,
  SettingsButton,
  Spinner,
  Toast,
  TokenPill,
  TokenTitle,
} from '../../ui';
import { SettingsSheet } from '../settings/SettingsSheet';
import { AddAddressSheet } from './AddAddressSheet';
import { AddressesTab } from './AddressesTab';
import { CurrentSite } from './CurrentSite';
import { useBalances } from './data';
import { useHomeEnv } from './env';
import { amountText, subline, tokenColor } from './format';
import { RenameSheet } from './RenameSheet';
import { Switcher } from './Switcher';
import { homeTabs, type HomeTabContext } from './tabs';

export interface HomeRoute {
  name: 'home.main';
  /** Opens on this token when it is in the list (the add-a-token link). */
  denom?: string;
  /** A short confirmation shown once on arrival. */
  toast?: string;
}

export interface SettingsTarget {
  name: 'settings.main';
}

/** Settings › Preferred tokens, which asks the password when saving needs it. */
export interface PickTokensTarget {
  name: 'settings.pickTokens';
}

/** The send flow's route (registered by the send feature). */
export interface SendTarget {
  name: 'send';
  denom: string;
  /** The address a row was tapped on: Send opens with it as From. */
  fromIndex?: number;
}

interface Loaded {
  network: 'mainnet' | 'testnet';
  brandThemes: boolean;
  tokens: ListedToken[];
  addresses: WalletAddress[];
}

const ADDRESSES = 'addresses';
const COPIED_MS = 1800;

export function Home() {
  const client = useClient();
  const env = useHomeEnv();
  const { route, navigate } = useRoute<
    HomeRoute | SettingsTarget | PickTokensTarget | SendTarget
  >();
  const arrival = route.name === 'home.main' ? route : undefined;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [denom, setDenom] = useState<string | null>(arrival?.denom ?? null);
  const [toast, setToast] = useState(arrival?.toast ?? '');
  // The token's brand data, fetched once per token so colours never flash.
  const [kit, setKit] = useState<{ denom: string; branding: DenomBranding | null } | null>(null);
  const [tab, setTab] = useState(ADDRESSES);
  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState<WalletAddress | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<{ index: number; at: number } | null>(null);
  const [scheme, setScheme] = useState(env.scheme.current());
  // `settings.main` is Home with the Settings sheet open (the way back from a settings screen).
  const [settings, setSettings] = useState(route.name === 'settings.main');
  const { balances, refresh } = useBalances(denom, loaded?.network ?? null);

  const load = useCallback(async () => {
    setFailed(false);
    const [ctx, tokens, addresses] = await Promise.all([
      client.call('home.context', {}),
      client.call('tokens.preferred', {}),
      client.call('wallet.addresses', {}),
    ]);
    let list = tokens;
    if (tokens.ok && tokens.value.length === 0) {
      // A new wallet starts with BZE as its one preferred token.
      list = await client.call('tokens.add', { denom: 'ubze' });
      // Weak lock: the list cannot be written here; the token picker asks the password.
      if (!list.ok && list.error.code === WalletErrorCodes.needsPassword) {
        navigate({ name: 'settings.pickTokens' });
        return;
      }
    }
    const first = list.ok ? list.value[0] : undefined;
    if (!ctx.ok || !list.ok || !addresses.ok || !first) {
      setFailed(true);
      return;
    }
    setLoaded({
      network: ctx.value.network,
      brandThemes: ctx.value.brandThemes,
      tokens: list.value,
      addresses: addresses.value.addresses,
    });
    setDenom((current) =>
      current !== null && list.value.some((x) => x.denom === current) ? current : first.denom,
    );
  }, [client, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      env.scheme.subscribe(() => {
        setScheme(env.scheme.current());
      }),
    [env],
  );

  // Read even with brand themes off: the token avatar keeps the token's own colour.
  useEffect(() => {
    if (denom === null) return;
    let live = true;
    void client.call('tokens.theme', { denom }).then((res) => {
      if (live) setKit({ denom, branding: res.ok ? res.value : null });
    });
    return () => {
      live = false;
    };
  }, [client, denom]);

  const brandThemes = loaded?.brandThemes ?? true;
  useEffect(() => {
    if (kit) {
      applyTheme(env.themeTarget, {
        denom: kit.denom,
        branding: kit.branding,
        brandThemes,
        scheme,
      });
    }
  }, [env, kit, brandThemes, scheme]);

  // Counted from the first render of the screen, not from the spinner before it.
  const shown = loaded !== null;
  useEffect(() => {
    if (toast === '' || !shown) return;
    return env.scheduler.after(COPIED_MS, () => {
      setToast('');
    });
  }, [toast, shown, env]);

  useEffect(() => {
    if (copied === null) return;
    return env.scheduler.after(COPIED_MS, () => {
      setCopied(null);
    });
  }, [copied, env]);

  if (failed) {
    return (
      <Layout>
        <div class="bp-home-center">
          <Banner tone="red">{t('home.failed')}</Banner>
          <Button onClick={() => void load()}>{t('home.retry')}</Button>
        </div>
      </Layout>
    );
  }
  const token = loaded?.tokens.find((x) => x.denom === denom);
  if (!loaded || !token) {
    return (
      <Layout>
        <div class="bp-home-center">
          <Spinner />
        </div>
      </Layout>
    );
  }

  const copy = (address: WalletAddress) => {
    env.clipboard.writeText(address.address).then(
      () => {
        setCopied((c) => ({ index: address.index, at: (c?.at ?? 0) + 1 }));
      },
      () => undefined,
    );
  };
  const added = (address: WalletAddress) => {
    setLoaded(
      (cur) =>
        cur && {
          ...cur,
          addresses: cur.addresses.some((a) => a.index === address.index)
            ? cur.addresses
            : [...cur.addresses, address],
        },
    );
    void refresh();
  };
  const rename = async (address: WalletAddress, label: string) => {
    const res = await client.call('wallet.renameAddress', { index: address.index, label });
    if (!res.ok) return false;
    const next = res.value.address;
    setLoaded(
      (cur) =>
        cur && {
          ...cur,
          addresses: cur.addresses.map((a) => (a.index === next.index ? next : a)),
        },
    );
    return true;
  };

  const unreadable = balances?.addresses.filter((a) => a.failed === true).length ?? 0;
  const allFailed = balances !== null && unreadable === balances.addresses.length;
  const total = !balances ? '…' : allFailed ? '—' : amountText(balances.total, token.decimals);
  // Empty only when every address was read and none holds the token.
  const none =
    balances !== null &&
    unreadable === 0 &&
    balances.addresses.every((a) => BigInt(a.amount) === 0n);
  const extra = homeTabs();
  const active = extra.find((x) => x.id === tab);
  const tabContext: HomeTabContext = {
    token,
    tokens: loaded.tokens,
    balances,
    addresses: loaded.addresses,
    refresh,
  };
  const color = tokenColor(token, kit?.denom === token.denom ? kit.branding : undefined);

  const header = (
    <HomeHeader
      token={
        loaded.tokens.length > 1 ? (
          <TokenPill
            symbol={token.symbol}
            color={color}
            logo={token.logo}
            label={t('home.token.switch', { symbol: token.symbol })}
            onClick={() => {
              setSwitcher(true);
            }}
          />
        ) : (
          <TokenTitle
            symbol={token.symbol}
            color={color}
            logo={token.logo}
            caption={t('home.token.wallet', { name: token.name })}
          />
        )
      }
      actions={
        <>
          {loaded.network === 'testnet' && <Pill>{t('home.network.testnet')}</Pill>}
          <AppearanceToggle />
          <SettingsButton
            onClick={() => {
              setSettings(true);
            }}
          />
        </>
      }
    />
  );

  // The footer row has no height: a toast floats 20 px above the frame's bottom edge.
  const toasts =
    toast !== '' || copied !== null ? (
      <>
        {toast !== '' && <Toast message={toast} />}
        {copied !== null && <Toast key={copied.at} message={t('home.copied')} />}
      </>
    ) : undefined;
  // Direct children of the body, so an open sheet covers the whole frame (frame.css).
  const sheets = (
    <>
      <Switcher
        open={switcher}
        tokens={loaded.tokens}
        selected={token.denom}
        onSelect={(d) => {
          setDenom(d);
          setTab(ADDRESSES);
        }}
        onTokens={(tokens) => {
          setLoaded((cur) => cur && { ...cur, tokens });
          if (!tokens.some((x) => x.denom === denom) && tokens[0]) setDenom(tokens[0].denom);
        }}
        onClose={() => {
          setSwitcher(false);
        }}
      />
      {renaming && (
        <RenameSheet
          key={renaming.index}
          address={renaming}
          onSave={(label) => rename(renaming, label)}
          onClose={() => {
            setRenaming(null);
          }}
        />
      )}
      {adding && (
        <AddAddressSheet
          onAdded={added}
          onClose={() => {
            setAdding(false);
          }}
        />
      )}
      <SettingsSheet
        open={settings}
        onClose={() => {
          setSettings(false);
        }}
        onChanged={() => {
          void load();
          void refresh();
        }}
      />
    </>
  );

  return (
    <Layout header={header} footer={toasts}>
      <main class="bp-home">
        {/* Remounted per network: a site is connected on one network only. */}
        <CurrentSite key={loaded.network} />
        <Card variant="edge">
          <section
            class="bp-home-balance"
            aria-label={t('home.balance.label', { symbol: token.symbol })}
          >
            <span class="bp-home-caption">{t('home.balance.caption', { name: token.name })}</span>
            <h1>
              <span class="bp-home-total">{total}</span>
              <small>{token.symbol}</small>
            </h1>
            {balances && !allFailed && <p>{subline(balances.addresses)}</p>}
            {allFailed && <p role="status">{t('home.balance.unavailable')}</p>}
            {balances?.partial === true && !allFailed && (
              <p role="status">{t('home.balance.partial')}</p>
            )}
          </section>
          <Button
            icon="send"
            iconSize={18}
            disabled={balances === null || allFailed || BigInt(balances.total) === 0n}
            onClick={() => {
              navigate({ name: 'send', denom: token.denom });
            }}
          >
            {t('home.send', { symbol: token.symbol })}
          </Button>
        </Card>
        <div class="bp-home-tabs">
          <Segmented
            label={t('home.tabs')}
            value={tab}
            onChange={setTab}
            options={[
              {
                value: ADDRESSES,
                label: t('home.tab.addresses'),
                count: loaded.addresses.length,
              },
              ...extra.map((x) => ({ value: x.id, label: x.label })),
            ]}
          />
          {active ? (
            active.action?.(tabContext)
          ) : (
            <Button
              variant="icon"
              icon="plus"
              iconSize={16}
              round
              label={t('home.address.add')}
              disabled={adding}
              onClick={() => {
                setAdding(true);
              }}
            />
          )}
        </div>
        {active ? (
          active.render(tabContext)
        ) : (
          <>
            {none && (
              <div class="bp-home-empty">
                <strong>{t('home.empty.title', { symbol: token.symbol })}</strong>
                <p>{t('home.empty.body', { symbol: token.symbol })}</p>
              </div>
            )}
            <AddressesTab
              decimals={token.decimals}
              symbol={token.symbol}
              balances={balances}
              addresses={loaded.addresses}
              copied={copied?.index ?? null}
              onCopy={copy}
              onRename={setRenaming}
              onSend={(address) => {
                navigate({ name: 'send', denom: token.denom, fromIndex: address.index });
              }}
            />
          </>
        )}
      </main>
      {sheets}
    </Layout>
  );
}
