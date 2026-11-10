import type { NetworkId } from '@beepocket/core';
import { WalletErrorCodes, type ListedToken } from '../../protocol';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, BottomBar, Button, InlineNote } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { homeTarget } from '../lock/targets';
import { TokenPicker } from '../tokens/TokenPicker';
import type { PickTokensRoute } from './routes';
import { NetworkPill } from './NetworkPill';
import { SETTINGS_PARENT, SettingsPage } from './SettingsPage';
import { TokenCodeField } from './TokenCodeField';

const networkName: Record<NetworkId, string> = {
  mainnet: t('settings.network.mainnet'),
  testnet: t('settings.network.testnet'),
};

const SETTINGS = SETTINGS_PARENT['settings.pickTokens'];

/** What the screen opened on: the network and the tokens picked on it then. */
interface Start {
  network: NetworkId;
  picked: string[];
  /** The picks themselves: listed even when the wallet holds none of them. */
  tokens: ListedToken[];
}

/**
 * Settings › Preferred tokens, on the onboarding token picker. It is also where a network switch
 * lands when that network has no preferred token yet: then there is no way back to a Home with
 * nothing to show, only picking tokens or switching to the other network.
 */
export function PickTokensScreen({ route }: { route: PickTokensRoute }) {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [start, setStart] = useState<Start | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // Tokens found by their code on this network, until it is switched.
  const [found, setFound] = useState<ListedToken[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Weak lock: the picks are kept and Save waits for the password.
  const [needsPassword, setNeedsPassword] = useState(false);

  const read = useCallback(async () => {
    const [network, tokens] = await Promise.all([
      client.call('network.get', {}),
      client.call('tokens.preferred', {}),
    ]);
    if (!network.ok || !tokens.ok) {
      setFailed(true);
      return null;
    }
    const picked = tokens.value.map((x) => x.denom);
    setStart({ network: network.value.id, picked, tokens: tokens.value });
    setSelected(picked);
    return picked;
  }, [client]);

  useEffect(() => {
    void read();
  }, [read]);

  const toggle = (denom: string) => {
    setSelected((s) => (s.includes(denom) ? s.filter((d) => d !== denom) : [...s, denom]));
  };

  const foundByCode = (token: ListedToken) => {
    setFound((f) => (f.some((x) => x.denom === token.denom) ? f : [...f, token]));
    setSelected((s) => (s.includes(token.denom) ? s : [...s, token.denom]));
  };

  /**
   * Adds the new picks first, so removing never meets the last-token rule halfway. The difference
   * is taken against the list as saved now, so a retry after the password sends only what is
   * still missing, whatever an interrupted attempt already wrote.
   */
  const save = async () => {
    if (!start || busy) return;
    setBusy(true);
    setFailed(false);
    const current = await client.call('tokens.preferred', {});
    if (!current.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    const saved = current.value.map((x) => x.denom);
    const added = selected.filter((d) => !saved.includes(d));
    const removed = saved.filter((d) => !selected.includes(d));
    // A failed add stops the save before anything is removed: never a half-applied set.
    let error: string | null = null;
    for (const denom of added) {
      const r = await client.call('tokens.add', { denom });
      if (!r.ok) {
        error = r.error.code;
        break;
      }
    }
    for (const denom of error === null ? removed : []) {
      const r = await client.call('tokens.remove', { denom });
      if (!r.ok) {
        error = r.error.code;
        break;
      }
    }
    setBusy(false);
    if (error === null) navigate(SETTINGS);
    else if (error === WalletErrorCodes.needsPassword) setNeedsPassword(true);
    else {
      setFailed(true);
      await read();
    }
  };

  const switchNetwork = async () => {
    if (!start) return;
    setFailed(false);
    const other: NetworkId = start.network === 'testnet' ? 'mainnet' : 'testnet';
    const r = await client.call('network.set', { id: other });
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setFound([]);
    const picked = await read();
    if (picked !== null && picked.length > 0) navigate(homeTarget);
  };

  if (start === null) {
    return (
      <SettingsPage title={t('settings.tokens')} parent={SETTINGS}>
        {failed && <Banner tone="red">{t('settings.saveFailed')}</Banner>}
      </SettingsPage>
    );
  }
  const landing = start.picked.length === 0;
  const extra = [...start.tokens, ...found].filter(
    (x, i, all) => all.findIndex((y) => y.denom === x.denom) === i,
  );
  const note =
    selected.length === 0
      ? t('settings.tokens.none')
      : t('settings.tokens.selected', { count: selected.length });
  return (
    <SettingsPage
      title={landing ? t('settings.network.pick.title') : t('settings.tokens')}
      parent={landing ? undefined : SETTINGS}
      closable={route.required !== true}
      network={start.network}
      right={<NetworkPill network={start.network} />}
      actions={
        needsPassword ? (
          <div class="bp-bottom">
            <p class="bp-bottom-bar-note" role="status">
              {note}
            </p>
            <PasswordGate
              submitLabel={t('settings.tokens.unlock')}
              labelIcon="lock"
              hold={selected.length === 0}
              onUnlocked={() => {
                setNeedsPassword(false);
                void save();
              }}
            />
          </div>
        ) : (
          <BottomBar note={note}>
            <Button
              disabled={selected.length === 0 || busy}
              onClick={() => {
                void save();
              }}
            >
              {t('settings.tokens.save')}
            </Button>
          </BottomBar>
        )
      }
    >
      <section class="bp-settings-tokens">
        {landing && (
          <div class="bp-settings-landing">
            <InlineNote tone="neutral" icon="alert-circle">
              {t('settings.network.pick.body', { network: networkName[start.network] })}
            </InlineNote>
            <Button
              variant="ghost"
              onClick={() => {
                void switchNetwork();
              }}
            >
              {t('settings.network.pick.switch')}
            </Button>
          </div>
        )}
        <TokenPicker
          selected={selected}
          onToggle={toggle}
          field={<TokenCodeField key={start.network} onFound={foundByCode} />}
          extra={extra}
          notice={
            needsPassword ? (
              <InlineNote tone="neutral" icon="lock">
                {t('settings.tokens.unlockHint')}
              </InlineNote>
            ) : (
              failed && <Banner tone="red">{t('settings.saveFailed')}</Banner>
            )
          }
        />
      </section>
    </SettingsPage>
  );
}
