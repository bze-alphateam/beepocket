import type { DenomBranding } from '@beepocket/core';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ListedToken, WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute } from '../../popup/router';
import { applyTheme } from '../../theme';
import { Banner, Button, Pill, Spinner } from '../../ui';
import { AddressesTab } from './AddressesTab';
import { useBalances } from './data';
import { useHomeEnv } from './env';
import { amountText, subline } from './format';
import { RenameSheet } from './RenameSheet';
import { Switcher } from './Switcher';
import { homeTabs } from './tabs';

export interface HomeRoute {
  name: 'home.main';
}

export interface SettingsTarget {
  name: 'settings.main';
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
  const { navigate } = useRoute<HomeRoute | SettingsTarget>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [denom, setDenom] = useState<string | null>(null);
  const [branding, setBranding] = useState<DenomBranding | null>(null);
  const [tab, setTab] = useState(ADDRESSES);
  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState<WalletAddress | null>(null);
  const [added, setAdded] = useState<WalletAddress | null>(null);
  const [addFailed, setAddFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scheme, setScheme] = useState(env.scheme.current());
  const { balances, refresh } = useBalances(denom);

  const load = useCallback(async () => {
    setFailed(false);
    const [ctx, tokens, addresses] = await Promise.all([
      client.call('home.context', {}),
      client.call('tokens.preferred', {}),
      client.call('wallet.addresses', {}),
    ]);
    const first = tokens.ok ? tokens.value[0] : undefined;
    if (!ctx.ok || !tokens.ok || !addresses.ok || !first) {
      setFailed(true);
      return;
    }
    setLoaded({
      network: ctx.value.network,
      brandThemes: ctx.value.brandThemes,
      tokens: tokens.value,
      addresses: addresses.value.addresses,
    });
    setDenom((current) =>
      current !== null && tokens.value.some((x) => x.denom === current) ? current : first.denom,
    );
  }, [client]);

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

  const brandThemes = loaded?.brandThemes ?? true;
  useEffect(() => {
    if (denom === null) return;
    let live = true;
    setBranding(null);
    if (brandThemes) {
      void client.call('tokens.theme', { denom }).then((res) => {
        if (live && res.ok) setBranding(res.value);
      });
    }
    return () => {
      live = false;
    };
  }, [client, denom, brandThemes]);

  useEffect(() => {
    applyTheme(env.themeTarget, { denom, branding, brandThemes, scheme });
  }, [env, denom, branding, brandThemes, scheme]);

  useEffect(() => {
    if (!copied) return;
    return env.scheduler.after(COPIED_MS, () => {
      setCopied(false);
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

  const copy = (address: string) => {
    void env.clipboard.writeText(address).then(() => {
      setCopied(true);
    });
  };
  const lock = () => {
    void client.call('wallet.lock', {}).then((res) => {
      if (res.ok) env.onLocked();
    });
  };
  const addAddress = async () => {
    setAddFailed(false);
    const res = await client.call('wallet.deriveNext', {});
    if (!res.ok) {
      setAddFailed(true);
      return;
    }
    setLoaded({ ...loaded, addresses: [...loaded.addresses, res.value.address] });
    setAdded(res.value.address);
    void refresh();
  };
  const rename = async (address: WalletAddress, label: string) => {
    const res = await client.call('wallet.renameAddress', { index: address.index, label });
    if (!res.ok) return false;
    const next = res.value.address;
    setLoaded({
      ...loaded,
      addresses: loaded.addresses.map((a) => (a.index === next.index ? next : a)),
    });
    return true;
  };

  const total = balances ? amountText(balances.total, token.decimals) : '…';
  const none = balances?.addresses.every((a) => BigInt(a.amount) === 0n);
  const extra = homeTabs();
  const active = extra.find((x) => x.id === tab);

  const header = (
    <>
      {loaded.tokens.length > 1 ? (
        <button
          type="button"
          class="bp-home-token"
          aria-label={t('home.token.select')}
          onClick={() => {
            setSwitcher(true);
          }}
        >
          {token.symbol} ▾
        </button>
      ) : (
        <span class="bp-home-token">{token.symbol}</span>
      )}
      <span class="bp-home-actions">
        {loaded.network === 'testnet' && <Pill>{t('home.network.testnet')}</Pill>}
        <button type="button" class="bp-home-icon" aria-label={t('home.lock')} onClick={lock}>
          🔒
        </button>
        <button
          type="button"
          class="bp-home-icon"
          aria-label={t('home.settings')}
          onClick={() => {
            navigate({ name: 'settings.main' });
          }}
        >
          ⚙
        </button>
      </span>
    </>
  );

  return (
    <Layout header={header}>
      <main class="bp-home">
        <section
          class="bp-home-balance"
          aria-label={t('home.balance.label', { symbol: token.symbol })}
        >
          <h1>
            {total} <small>{token.symbol}</small>
          </h1>
          {balances && <p>{subline(balances.addresses)}</p>}
          {balances?.partial === true && <p role="status">{t('home.balance.partial')}</p>}
        </section>
        <div class="bp-home-tabs" role="tablist" aria-label={t('home.tabs')}>
          {[{ id: ADDRESSES, label: t('home.tab.addresses') }, ...extra].map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === tab}
              onClick={() => {
                setTab(x.id);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        {active ? (
          active.render({ token, balances, addresses: loaded.addresses })
        ) : (
          <>
            {none === true && (
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
              onCopy={copy}
              onRename={setRenaming}
              onAdd={() => void addAddress()}
            />
            {addFailed && <p role="alert">{t('home.address.error')}</p>}
          </>
        )}
        {copied && (
          <div class="bp-home-toast" role="status">
            {t('home.copied')}
          </div>
        )}
      </main>
      <Switcher
        open={switcher}
        tokens={loaded.tokens}
        selected={token.denom}
        onSelect={(d) => {
          setDenom(d);
          setTab(ADDRESSES);
        }}
        onTokens={(tokens) => {
          setLoaded({ ...loaded, tokens });
          if (!tokens.some((x) => x.denom === denom) && tokens[0]) setDenom(tokens[0].denom);
        }}
        onClose={() => {
          setSwitcher(false);
        }}
      />
      {renaming && (
        <RenameSheet
          open
          key={renaming.index}
          title={t('home.rename.title')}
          initial={renaming.label}
          saveLabel="home.rename.save"
          onSave={(label) => rename(renaming, label)}
          onClose={() => {
            setRenaming(null);
          }}
        />
      )}
      {added && (
        <RenameSheet
          open
          key={`add-${String(added.index)}`}
          title={t('home.add.title')}
          intro={t('home.add.body')}
          initial={added.label}
          saveLabel="home.add.done"
          onSave={(label) => rename(added, label)}
          onClose={() => {
            setAdded(null);
          }}
        />
      )}
    </Layout>
  );
}
