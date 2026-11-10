import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { NetworkId } from '@beepocket/core';
import { t } from '../../i18n';
import { useAppearance } from '../../popup/appearance';
import { useClient } from '../../popup/client-context';
import { useRoute, type RouteBase } from '../../popup/router';
import type { WalletSettings } from '../../protocol';
import type { Appearance } from '../../theme';
import { Banner, DropdownSheet, Segmented, SettingsRow, Spinner, Toggle } from '../../ui';
import { useLock } from '../lock/useLock';
import { isLockChoice, LOCK_CHOICES, minutesLabel } from './lock-options';
import { SETTINGS_PARENT, SettingsPage } from './SettingsPage';
import { useSettingsData, type SettingsData } from './useSettingsData';

const APPEARANCES: readonly { value: Appearance; label: string }[] = [
  { value: 'dark', label: t('settings.appearance.dark') },
  { value: 'light', label: t('settings.appearance.light') },
  { value: 'system', label: t('settings.appearance.system') },
];

/** One lock time with its dropdown; values outside the offered list are shown, never sent. */
function LockRow(props: {
  title: string;
  sub: string;
  value: number;
  onChange: (minutes: number) => void;
}) {
  const choices = LOCK_CHOICES.includes(props.value)
    ? LOCK_CHOICES
    : [...LOCK_CHOICES, props.value];
  return (
    <SettingsRow title={props.title} sub={props.sub}>
      <DropdownSheet
        title={props.title}
        value={String(props.value)}
        options={[...choices]
          .sort((a, b) => a - b)
          .map((n) => ({ value: String(n), label: minutesLabel(n) }))}
        onChange={(v) => {
          const minutes = LOCK_CHOICES.find((n) => String(n) === v);
          if (minutes !== undefined && minutes !== props.value) props.onChange(minutes);
        }}
      />
    </SettingsRow>
  );
}

type PageName = keyof typeof SETTINGS_PARENT | 'settings.main';

/** A page of the tree: its frame, the load/error states and the rows once the data is in. */
function DataPage(props: {
  name: PageName;
  title: string;
  content: (d: SettingsData, s: ReturnType<typeof useSettingsData>) => ComponentChildren;
}) {
  const state = useSettingsData();
  const parent = props.name === 'settings.main' ? undefined : SETTINGS_PARENT[props.name];
  let body: ComponentChildren;
  if (state.failed) body = <Banner tone="red">{t('settings.loadFailed')}</Banner>;
  else if (!state.data) body = <Spinner />;
  else {
    body = (
      <div class="bp-settings-list">
        {state.error !== null && <Banner tone="red">{state.error}</Banner>}
        {props.content(state.data, state)}
      </div>
    );
  }
  return (
    <SettingsPage title={props.title} parent={parent} network={state.data?.network}>
      {body}
    </SettingsPage>
  );
}

/** Settings: Manage tokens, Configuration, Address book, Lock wallet. */
export function SettingsMain() {
  const { navigate } = useRoute<RouteBase>();
  const lockWallet = useLock();
  return (
    <DataPage
      name="settings.main"
      title={t('settings.title')}
      content={(d) => (
        <>
          <SettingsRow
            icon="grid"
            title={t('settings.tokens')}
            value={String(d.tokens)}
            onClick={() => {
              navigate({ name: 'settings.pickTokens' });
            }}
          />
          <SettingsRow
            icon="sliders"
            title={t('settings.configuration')}
            onClick={() => {
              navigate({ name: 'settings.configuration' });
            }}
          />
          <SettingsRow
            icon="book"
            title={t('settings.addressBook')}
            value={String(d.contacts)}
            onClick={() => {
              navigate({ name: 'settings.book' });
            }}
          />
          <SettingsRow
            icon="lock"
            title={t('settings.lock')}
            onClick={() => {
              void lockWallet();
            }}
          />
        </>
      )}
    />
  );
}

/** Settings › Configuration: Appearance, Connected sites, Security, Advanced. */
export function SettingsConfiguration() {
  const { navigate } = useRoute<RouteBase>();
  return (
    <DataPage
      name="settings.configuration"
      title={t('settings.configuration')}
      content={(d) => (
        <>
          <SettingsRow
            icon="sun"
            title={t('settings.appearance')}
            onClick={() => {
              navigate({ name: 'settings.appearance' });
            }}
          />
          <SettingsRow
            icon="link"
            title={t('sites.row')}
            value={String(d.sites)}
            label={t('sites.row.count', { count: d.sites })}
            onClick={() => {
              navigate({ name: 'dapp.sites' });
            }}
          />
          <SettingsRow
            icon="shield"
            title={t('settings.security')}
            onClick={() => {
              navigate({ name: 'settings.security' });
            }}
          />
          <SettingsRow
            icon="code"
            title={t('settings.advanced')}
            onClick={() => {
              navigate({ name: 'settings.advanced' });
            }}
          />
        </>
      )}
    />
  );
}

/** Settings › Appearance: the colour scheme and the token brand themes. */
export function SettingsAppearance() {
  const appearanceState = useAppearance();
  // Kept here: the state only tells when the scheme shown changes, not every pick.
  const [appearance, setAppearance] = useState(appearanceState.appearance);
  return (
    <DataPage
      name="settings.appearance"
      title={t('settings.appearance')}
      content={(d, s) => (
        <>
          <SettingsRow title={t('settings.appearance')}>
            <Segmented
              kind="radio"
              label={t('settings.appearance')}
              value={appearance}
              onChange={(v) => {
                setAppearance(v);
                appearanceState.set(v);
              }}
              options={APPEARANCES}
            />
          </SettingsRow>
          <Toggle
            title={t('settings.brandThemes')}
            description={t('settings.brandThemes.hint')}
            checked={d.settings.brandThemes}
            onChange={(on) => {
              s.setData({ ...d, settings: { ...d.settings, brandThemes: on } });
              void s.save({ brandThemes: on });
            }}
          />
        </>
      )}
    />
  );
}

/** Settings › Security: lock timers and the recovery phrase. */
export function SettingsSecurity() {
  const { navigate } = useRoute<RouteBase>();
  return (
    <DataPage
      name="settings.security"
      title={t('settings.security')}
      content={(d) => (
        <>
          <SettingsRow
            icon="clock"
            title={t('settings.timers')}
            value={`${minutesLabel(d.settings.weakLockMinutes)} · ${minutesLabel(d.settings.fullLockMinutes)}`}
            onClick={() => {
              navigate({ name: 'settings.timers' });
            }}
          />
          <SettingsRow
            icon="key"
            title={t('settings.reveal')}
            value={t('settings.reveal.note')}
            note
            onClick={() => {
              navigate({ name: 'settings.reveal' });
            }}
          />
        </>
      )}
    />
  );
}

/** Settings › Security › Lock timers. */
export function SettingsTimers() {
  return (
    <DataPage
      name="settings.timers"
      title={t('settings.timers')}
      content={(d, s) => {
        const set = (key: 'weakLockMinutes' | 'fullLockMinutes') => (minutes: number) => {
          if (isLockChoice(minutes)) void s.save({ [key]: minutes } as Partial<WalletSettings>);
        };
        return (
          <>
            <LockRow
              title={t('settings.weakLock')}
              sub={t('settings.weakLock.hint')}
              value={d.settings.weakLockMinutes}
              onChange={set('weakLockMinutes')}
            />
            <LockRow
              title={t('settings.fullLock')}
              sub={t('settings.fullLock.hint')}
              value={d.settings.fullLockMinutes}
              onChange={set('fullLockMinutes')}
            />
          </>
        );
      }}
    />
  );
}

/** Settings › Advanced: the testnet switch. */
export function SettingsAdvanced() {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  return (
    <DataPage
      name="settings.advanced"
      title={t('settings.advanced')}
      content={(d, s) => (
        <Toggle
          title={t('settings.testnet')}
          description={t('settings.testnet.hint')}
          checked={d.network === 'testnet'}
          onChange={(testnet) => {
            void (async () => {
              s.setError(null);
              const before = d.network;
              const id: NetworkId = testnet ? 'testnet' : 'mainnet';
              // Shown at once; put back if the worker refuses.
              s.setData({ ...d, network: id });
              const r = await client.call('network.set', { id });
              if (!r.ok) {
                s.setData({ ...d, network: before });
                s.setError(t('settings.saveFailed'));
                return;
              }
              const tokens = await client.call('tokens.preferred', {});
              if (tokens.ok && tokens.value.length === 0) {
                navigate({ name: 'settings.pickTokens' });
                return;
              }
              void s.reload();
            })();
          }}
        />
      )}
    />
  );
}
