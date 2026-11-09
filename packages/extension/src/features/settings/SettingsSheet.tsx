import { NETWORKS, type NetworkId } from '@beepocket/core';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { WalletErrorCodes, type WalletSettings } from '../../protocol';
import { useAppearance } from '../../popup/appearance';
import { useClient } from '../../popup/client-context';
import { useRoute, type RouteBase } from '../../popup/router';
import type { Appearance } from '../../theme';
import {
  Banner,
  DropdownSheet,
  Logo,
  Segmented,
  SettingsRow,
  Sheet,
  Spinner,
  Toggle,
} from '../../ui';
import { AddressBookSheet } from '../address-book';
import { useLock } from '../lock/useLock';
import { useSettingsEnv } from './env';
import { isLockChoice, LOCK_CHOICES, minutesLabel } from './lock-options';
import { RevealPhrase } from './RevealPhrase';

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Something Home shows changed (network, brand themes): Home reads its data again. */
  onChanged: () => void;
  /** The level to open at: Configuration when coming back from Connected sites. */
  initialPanel?: 'main' | 'configuration';
}

/** What the rows show; read each time the sheet opens. */
interface Data {
  settings: WalletSettings;
  network: NetworkId;
  tokens: number;
  contacts: number;
  sites: number;
}

/** Where in the tree the sheet is; closing a level goes to its parent (`PARENT`). */
type Panel =
  'main' | 'configuration' | 'appearance' | 'security' | 'advanced' | 'timers' | 'book' | 'reveal';

const PARENT: Record<Exclude<Panel, 'main'>, Panel> = {
  configuration: 'main',
  appearance: 'configuration',
  security: 'configuration',
  advanced: 'configuration',
  timers: 'security',
  reveal: 'security',
  book: 'main',
};

const APPEARANCES: readonly { value: Appearance; label: string }[] = [
  { value: 'dark', label: t('settings.appearance.dark') },
  { value: 'light', label: t('settings.appearance.light') },
  { value: 'system', label: t('settings.appearance.system') },
];

/** The footer: the logo, the version and the chain; `links` sits under them (Privacy). */
export function SettingsFooter(props: {
  version: string;
  chainId: string;
  links?: ComponentChildren;
}) {
  return (
    <footer class="bp-settings-footer">
      <span class="bp-settings-footer-line">
        <Logo size={20} />
        {t('settings.footer', { version: props.version, chain: props.chainId })}
      </span>
      {props.links}
    </footer>
  );
}

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

/**
 * Settings, a sheet over Home (`W-Settings`): Manage tokens, Configuration (Appearance, Connected
 * sites, Security, Advanced), Address book and Lock wallet. Each level opens as its own sheet,
 * only one at a time, and closing it goes back exactly one level. Closing the whole thing drops
 * the phrase with the reveal sheet.
 */
export function SettingsSheet({ open, onClose, onChanged, initialPanel }: SettingsSheetProps) {
  const client = useClient();
  const env = useSettingsEnv();
  const appearanceState = useAppearance();
  const lockWallet = useLock();
  const { navigate } = useRoute<RouteBase>();
  const [panel, setPanel] = useState<Panel>(initialPanel ?? 'main');
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept here: the state only tells when the scheme shown changes, not every pick.
  const [appearance, setAppearance] = useState(appearanceState.appearance);

  const load = useCallback(async () => {
    const [settings, network, tokens, book, sites] = await Promise.all([
      client.call('settings.get', {}),
      client.call('network.get', {}),
      client.call('tokens.preferred', {}),
      client.call('book.list', {}),
      client.call('sites.list', {}),
    ]);
    if (!settings.ok || !network.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData({
      settings: settings.value,
      network: network.value.id,
      tokens: tokens.ok ? tokens.value.length : 0,
      contacts: book.ok ? book.value.contacts.length : 0,
      sites: sites.ok ? sites.value.sites.length : 0,
    });
  }, [client]);

  useEffect(() => {
    if (!open) {
      setPanel('main');
      setError(null);
      return;
    }
    setAppearance(appearanceState.appearance);
    void load();
  }, [open, load, appearanceState]);

  if (!open) return null;

  const save = async (patch: Partial<WalletSettings>) => {
    setError(null);
    const r = await client.call('settings.set', patch);
    if (r.ok) {
      setData((d) => d && { ...d, settings: r.value });
      if (patch.brandThemes !== undefined) onChanged();
      return;
    }
    // Shows what is stored again (a switch flipped before the save goes back).
    void load();
    if (r.error.code === WalletErrorCodes.invalidSettings) setError(t('settings.invalid'));
    else if (r.error.code === WalletErrorCodes.needsPassword) setError(t('settings.needsUnlock'));
    else setError(t('settings.saveFailed'));
  };

  const setLockTime = (key: 'weakLockMinutes' | 'fullLockMinutes', minutes: number) => {
    if (isLockChoice(minutes)) void save({ [key]: minutes });
  };

  const toggleNetwork = async (testnet: boolean) => {
    if (!data) return;
    setError(null);
    const before = data.network;
    const id: NetworkId = testnet ? 'testnet' : 'mainnet';
    // Shown at once; put back if the worker refuses.
    setData({ ...data, network: id });
    const r = await client.call('network.set', { id });
    if (!r.ok) {
      setData((d) => d && { ...d, network: before });
      setError(t('settings.saveFailed'));
      return;
    }
    const tokens = await client.call('tokens.preferred', {});
    if (tokens.ok && tokens.value.length === 0) {
      navigate({ name: 'settings.pickTokens' });
      return;
    }
    onChanged();
    void load();
  };

  const back = (from: Exclude<Panel, 'main'>) => () => {
    setPanel(PARENT[from]);
  };

  if (panel === 'book') {
    return (
      <AddressBookSheet open mode="manage" onClose={back('book')} onChanged={() => void load()} />
    );
  }
  if (panel === 'reveal') return <RevealPhrase onClose={back('reveal')} />;

  const banner = error !== null && <Banner tone="red">{error}</Banner>;

  /** A nested level: its own sheet, the error banner on top, one step back on close. */
  const level = (
    from: Exclude<Panel, 'main' | 'book' | 'reveal'>,
    title: string,
    content: (d: Data) => ComponentChildren,
  ) => (
    <Sheet open title={title} onClose={back(from)}>
      {failed ? (
        <Banner tone="red">{t('settings.loadFailed')}</Banner>
      ) : !data ? (
        <Spinner />
      ) : (
        <div class="bp-settings-list">
          {banner}
          {content(data)}
        </div>
      )}
    </Sheet>
  );

  if (panel === 'timers') {
    return level('timers', t('settings.timers'), (d) => (
      <>
        <LockRow
          title={t('settings.weakLock')}
          sub={t('settings.weakLock.hint')}
          value={d.settings.weakLockMinutes}
          onChange={(n) => {
            setLockTime('weakLockMinutes', n);
          }}
        />
        <LockRow
          title={t('settings.fullLock')}
          sub={t('settings.fullLock.hint')}
          value={d.settings.fullLockMinutes}
          onChange={(n) => {
            setLockTime('fullLockMinutes', n);
          }}
        />
      </>
    ));
  }

  if (panel === 'appearance') {
    return level('appearance', t('settings.appearance'), (d) => (
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
            setData({ ...d, settings: { ...d.settings, brandThemes: on } });
            void save({ brandThemes: on });
          }}
        />
      </>
    ));
  }

  if (panel === 'security') {
    return level('security', t('settings.security'), (d) => (
      <>
        <SettingsRow
          icon="clock"
          title={t('settings.timers')}
          value={`${minutesLabel(d.settings.weakLockMinutes)} · ${minutesLabel(d.settings.fullLockMinutes)}`}
          onClick={() => {
            setPanel('timers');
          }}
        />
        <SettingsRow
          icon="key"
          title={t('settings.reveal')}
          value={t('settings.reveal.note')}
          note
          onClick={() => {
            setPanel('reveal');
          }}
        />
      </>
    ));
  }

  if (panel === 'advanced') {
    return level('advanced', t('settings.advanced'), (d) => (
      <Toggle
        title={t('settings.testnet')}
        description={t('settings.testnet.hint')}
        checked={d.network === 'testnet'}
        onChange={(on) => {
          void toggleNetwork(on);
        }}
      />
    ));
  }

  if (panel === 'configuration') {
    return level('configuration', t('settings.configuration'), (d) => (
      <>
        <SettingsRow
          icon="sun"
          title={t('settings.appearance')}
          onClick={() => {
            setPanel('appearance');
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
            setPanel('security');
          }}
        />
        <SettingsRow
          icon="code"
          title={t('settings.advanced')}
          onClick={() => {
            setPanel('advanced');
          }}
        />
      </>
    ));
  }

  let body;
  if (failed) body = <Banner tone="red">{t('settings.loadFailed')}</Banner>;
  else if (!data) body = <Spinner />;
  else {
    body = (
      <div class="bp-settings-list">
        {banner}
        <SettingsRow
          icon="grid"
          title={t('settings.tokens')}
          value={String(data.tokens)}
          onClick={() => {
            navigate({ name: 'settings.pickTokens' });
          }}
        />
        <SettingsRow
          icon="sliders"
          title={t('settings.configuration')}
          onClick={() => {
            setPanel('configuration');
          }}
        />
        <SettingsRow
          icon="book"
          title={t('settings.addressBook')}
          value={String(data.contacts)}
          onClick={() => {
            setPanel('book');
          }}
        />
        <SettingsRow
          icon="lock"
          title={t('settings.lock')}
          onClick={() => {
            void lockWallet();
          }}
        />
        <SettingsFooter version={env.manifest.version()} chainId={NETWORKS[data.network].chainId} />
      </div>
    );
  }

  return (
    <Sheet open title={t('settings.title')} onClose={onClose}>
      {body}
    </Sheet>
  );
}
