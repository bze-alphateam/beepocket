import type { NetworkId } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, Button } from '../../ui';
import { homeTarget } from '../lock/targets';
import { NetworkPill } from './NetworkPill';

const networkName: Record<NetworkId, string> = {
  mainnet: t('settings.network.mainnet'),
  testnet: t('settings.network.testnet'),
};

/**
 * Where a network switch lands when that network has no preferred token yet. Minimal on
 * purpose: add BZE or switch to the other network (the onboarding token step is not shared yet).
 */
export function PickTokensScreen() {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [network, setNetwork] = useState<NetworkId | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void client.call('network.get', {}).then((r) => {
      if (live && r.ok) setNetwork(r.value.id);
    });
    return () => {
      live = false;
    };
  }, [client]);

  const addBze = async () => {
    setFailed(false);
    const r = await client.call('tokens.add', { denom: 'ubze' });
    if (r.ok) navigate(homeTarget);
    else setFailed(true);
  };

  const switchNetwork = async () => {
    setFailed(false);
    const other: NetworkId = network === 'testnet' ? 'mainnet' : 'testnet';
    const r = await client.call('network.set', { id: other });
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setNetwork(r.value.id);
    const tokens = await client.call('tokens.preferred', {});
    if (tokens.ok && tokens.value.length > 0) navigate(homeTarget);
  };

  if (network === null) return <Layout>{null}</Layout>;
  return (
    <Layout header={<NetworkPill network={network} />}>
      <main class="bp-settings">
        <h1>{t('settings.network.pick.title')}</h1>
        <p>{t('settings.network.pick.body', { network: networkName[network] })}</p>
        {failed && <Banner tone="red">{t('settings.saveFailed')}</Banner>}
        <Button
          onClick={() => {
            void addBze();
          }}
        >
          {t('settings.network.pick.add')}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            void switchNetwork();
          }}
        >
          {t('settings.network.pick.switch')}
        </Button>
      </main>
    </Layout>
  );
}
