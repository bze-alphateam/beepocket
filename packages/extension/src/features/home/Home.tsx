import type { DenomBranding } from '@beepocket/core';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { ListedToken, WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute } from '../../popup/router';
import { applyTheme } from '../../theme';
import { Banner, Button, Pill, Spinner } from '../../ui';
import { useLock } from '../lock/useLock';
import { AddressesTab } from './AddressesTab';
import { useBalances } from './data';
import { useHomeEnv } from './env';
import { amountText, subline } from './format';
import { RenameSheet } from './RenameSheet';
import { Switcher } from './Switcher';
import { homeTabs } from './tabs';

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

/** The send flow's route (registered by the send feature). */
export interface SendTarget {
  name: 'send';
  denom: string;
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
  const { route, navigate } = useRoute<HomeRoute | SettingsTarget | SendTarget>();
  const arrival = route.name === 'home.main' ? route : undefined;
  const lockWallet = useLock();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [denom, setDenom] = useState<string | null>(arrival?.denom ?? null);
  const [toast, setToast] = useState(arrival?.toast ?? '');
  // The kit on screen: set once per token, after its brand data arrived, so colours never flash.
  const [kit, setKit] = useState<{ denom: string; branding: DenomBranding | null } | null>(null);
  const [tab, setTab] = useState(ADDRESSES);
  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState<WalletAddress | null>(null);
  const [added, setAdded] = useState<WalletAddress | null>(null);
  const [addFailed, setAddFailed] = useState(false);
  const [copiedAt, setCopiedAt] = useState(0);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [scheme, setScheme] = useState(env.scheme.current());
  const { balances, refresh } = useBalances(denom);

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
    if (brandThemes) {
      void client.call('tokens.theme', { denom }).then((res) => {
        if (live) setKit({ denom, branding: res.ok ? res.value : null });
      });
    } else setKit({ denom, branding: null });
    return () => {
      live = false;
    };
  }, [client, denom, brandThemes]);

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

  useEffect(() => {
    if (toast === '') return;
    return env.scheduler.after(COPIED_MS, () => {
      setToast('');
    });
  }, [toast, env]);

  useEffect(() => {
    if (copiedAt === 0) return;
    return env.scheduler.after(COPIED_MS, () => {
      setCopiedAt(0);
    });
  }, [copiedAt, env]);

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
    env.clipboard.writeText(address).then(
      () => {
        setCopiedAt((n) => n + 1);
      },
      () => undefined,
    );
  };
  const lock = () => {
    void lockWallet();
  };
  const addAddress = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setAddFailed(false);
    const res = await client.call('wallet.deriveNext', {});
    addingRef.current = false;
    setAdding(false);
    if (!res.ok) {
      setAddFailed(true);
      return;
    }
    const created = res.value.address;
    setLoaded(
      (cur) =>
        cur && {
          ...cur,
          addresses: cur.addresses.some((a) => a.index === created.index)
            ? cur.addresses
            : [...cur.addresses, created],
        },
    );
    setAdded(created);
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
          {balances && !allFailed && <p>{subline(balances.addresses)}</p>}
          {allFailed && <p role="status">{t('home.balance.unavailable')}</p>}
          <Button
            disabled={balances === null || allFailed || BigInt(balances.total) === 0n}
            onClick={() => {
              navigate({ name: 'send', denom: token.denom });
            }}
          >
            {t('send.title', { symbol: token.symbol })}
          </Button>
          {balances?.partial === true && !allFailed && (
            <p role="status">{t('home.balance.partial')}</p>
          )}
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
          active.render({
            token,
            tokens: loaded.tokens,
            balances,
            addresses: loaded.addresses,
            refresh,
          })
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
              onCopy={copy}
              onRename={setRenaming}
              adding={adding}
              onAdd={() => void addAddress()}
            />
            {addFailed && <p role="alert">{t('home.address.error')}</p>}
          </>
        )}
        {toast !== '' && (
          <div class="bp-home-toast" role="status">
            {toast}
          </div>
        )}
        {copiedAt > 0 && (
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
          setLoaded((cur) => cur && { ...cur, tokens });
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
