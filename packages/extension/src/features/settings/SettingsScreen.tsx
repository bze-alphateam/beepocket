import type { NetworkId } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { WalletErrorCodes, type WalletSettings } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, Button, Spinner } from '../../ui';
import type { ManifestSource } from './manifest';
import { homeTarget } from '../lock/targets';
import { NetworkPill } from './NetworkPill';
import { RevealPhrase } from './RevealPhrase';

const LOCK_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440, 10080];

function minutesLabel(n: number): string {
  if (n % 1440 === 0) return t('settings.days', { count: n / 1440 });
  if (n % 60 === 0) return t('settings.hours', { count: n / 60 });
  return t('settings.minutes', { count: n });
}

function LockSelect(props: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const choices = LOCK_CHOICES.includes(props.value)
    ? LOCK_CHOICES
    : [...LOCK_CHOICES, props.value].sort((a, b) => a - b);
  return (
    <label class="bp-row">
      <span class="bp-row-text">
        <span>{props.label}</span>
        <small>{props.hint}</small>
      </span>
      <select
        value={String(props.value)}
        onChange={(e) => {
          props.onChange(Number(e.currentTarget.value));
        }}
      >
        {choices.map((n) => (
          <option key={n} value={String(n)}>
            {minutesLabel(n)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Switch(props: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label class="bp-row">
      <span class="bp-row-text">
        <span>{props.label}</span>
        <small>{props.hint}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => {
          props.onChange(e.currentTarget.checked);
        }}
      />
    </label>
  );
}

export function SettingsScreen({ manifest }: { manifest: ManifestSource }) {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [settings, setSettings] = useState<WalletSettings | null>(null);
  const [network, setNetwork] = useState<NetworkId>('mainnet');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([client.call('settings.get', {}), client.call('network.get', {})]).then(
      ([s, n]) => {
        if (!live) return;
        if (s.ok) setSettings(s.value);
        else setFailed(true);
        if (n.ok) setNetwork(n.value.id);
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  const save = async (patch: Partial<WalletSettings>) => {
    setError(null);
    const r = await client.call('settings.set', patch);
    if (r.ok) setSettings(r.value);
    else if (r.error.code === WalletErrorCodes.invalidSettings) setError(t('settings.invalid'));
    else if (r.error.code === WalletErrorCodes.needsPassword) setError(t('settings.needsUnlock'));
    else setError(t('settings.saveFailed'));
  };

  const toggleNetwork = async (testnet: boolean) => {
    setError(null);
    const id: NetworkId = testnet ? 'testnet' : 'mainnet';
    const r = await client.call('network.set', { id });
    if (!r.ok) {
      setError(t('settings.saveFailed'));
      return;
    }
    setNetwork(r.value.id);
    const tokens = await client.call('tokens.preferred', {});
    if (tokens.ok && tokens.value.length === 0) navigate({ name: 'settings.pickTokens' });
  };

  const header = (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          navigate(homeTarget);
        }}
      >
        {t('settings.back')}
      </Button>
      <strong>{t('settings.title')}</strong>
      <NetworkPill network={network} />
    </>
  );

  if (failed) {
    return (
      <Layout header={header}>
        <Banner tone="red">{t('settings.loadFailed')}</Banner>
      </Layout>
    );
  }
  if (settings === null) {
    return (
      <Layout header={header}>
        <Spinner />
      </Layout>
    );
  }

  return (
    <Layout header={header}>
      <main class="bp-settings">
        {error !== null && <Banner tone="red">{error}</Banner>}
        <Switch
          label={t('settings.brandThemes')}
          hint={t('settings.brandThemes.hint')}
          checked={settings.brandThemes}
          onChange={(on) => {
            void save({ brandThemes: on });
          }}
        />
        <LockSelect
          label={t('settings.weakLock')}
          hint={t('settings.weakLock.hint')}
          value={settings.weakLockMinutes}
          onChange={(n) => {
            void save({ weakLockMinutes: n });
          }}
        />
        <LockSelect
          label={t('settings.fullLock')}
          hint={t('settings.fullLock.hint')}
          value={settings.fullLockMinutes}
          onChange={(n) => {
            void save({ fullLockMinutes: n });
          }}
        />
        <button
          type="button"
          class="bp-row"
          onClick={() => {
            navigate({ name: 'book' });
          }}
        >
          {t('settings.addressBook')}
        </button>
        <button
          type="button"
          class="bp-row"
          onClick={() => {
            setRevealing(true);
          }}
        >
          <span class="bp-row-text">
            <span>{t('settings.reveal')}</span>
            <small>{t('settings.reveal.hint')}</small>
          </span>
        </button>
        <Switch
          label={t('settings.testnet')}
          hint={t('settings.testnet.hint')}
          checked={network === 'testnet'}
          onChange={(on) => {
            void toggleNetwork(on);
          }}
        />
        <section class="bp-row bp-about">
          <span class="bp-row-text">
            <span>{t('settings.about')}</span>
            <small>{t('settings.about.version', { version: manifest.version() })}</small>
            <small>{t('settings.about.repo')}</small>
          </span>
        </section>
      </main>
      {revealing && (
        <RevealPhrase
          onClose={() => {
            setRevealing(false);
          }}
        />
      )}
    </Layout>
  );
}
