import type { NetworkId } from '@beepocket/core';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, BottomBar, Button, InlineNote, ScreenHeader } from '../../ui';
import { homeTarget } from '../lock/targets';
import { TokenPicker } from '../tokens/TokenPicker';
import { NetworkPill } from './NetworkPill';

const networkName: Record<NetworkId, string> = {
  mainnet: t('settings.network.mainnet'),
  testnet: t('settings.network.testnet'),
};

const SETTINGS: RouteBase = { name: 'settings.main' };

/** What the screen opened on: the network and the tokens picked on it then. */
interface Start {
  network: NetworkId;
  picked: string[];
}

/**
 * Settings › Preferred tokens, on the onboarding token picker. It is also where a network switch
 * lands when that network has no preferred token yet: then there is no way back to a Home with
 * nothing to show, only picking tokens or switching to the other network.
 */
export function PickTokensScreen() {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [start, setStart] = useState<Start | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setStart({ network: network.value.id, picked });
    setSelected(picked);
    return picked;
  }, [client]);

  useEffect(() => {
    void read();
  }, [read]);

  const toggle = (denom: string) => {
    setSelected((s) => (s.includes(denom) ? s.filter((d) => d !== denom) : [...s, denom]));
  };

  /** Adds the new picks first, so removing never meets the last-token rule halfway. */
  const save = async () => {
    if (!start || busy) return;
    setBusy(true);
    setFailed(false);
    const added = selected.filter((d) => !start.picked.includes(d));
    const removed = start.picked.filter((d) => !selected.includes(d));
    // A failed add stops the save before anything is removed: never a half-applied set.
    let ok = true;
    for (const denom of added) {
      ok = (await client.call('tokens.add', { denom })).ok;
      if (!ok) break;
    }
    for (const denom of ok ? removed : []) {
      ok = (await client.call('tokens.remove', { denom })).ok;
      if (!ok) break;
    }
    setBusy(false);
    if (ok) navigate(SETTINGS);
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
    const picked = await read();
    if (picked !== null && picked.length > 0) navigate(homeTarget);
  };

  if (start === null) {
    return <Layout>{failed && <Banner tone="red">{t('settings.saveFailed')}</Banner>}</Layout>;
  }
  const landing = start.picked.length === 0;
  const note =
    selected.length === 0
      ? t('settings.tokens.none')
      : t('settings.tokens.selected', { count: selected.length });
  return (
    <Layout
      header={
        <ScreenHeader
          title={landing ? t('settings.network.pick.title') : t('settings.tokens')}
          onBack={
            landing
              ? undefined
              : () => {
                  navigate(SETTINGS);
                }
          }
          right={<NetworkPill network={start.network} />}
        />
      }
      footer={
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
          notice={failed && <Banner tone="red">{t('settings.saveFailed')}</Banner>}
        />
      </section>
    </Layout>
  );
}
