import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, Button } from '../../ui';
import { NetworkPill } from './NetworkPill';

/**
 * Where a network switch lands when that network has no preferred token yet. Minimal on
 * purpose: add BZE or switch back (the onboarding token step is not shared yet).
 */
export function PickTokensScreen() {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [failed, setFailed] = useState(false);

  const addBze = async () => {
    const r = await client.call('tokens.add', { denom: 'ubze' });
    if (r.ok) navigate({ name: 'shell.home' });
    else setFailed(true);
  };

  return (
    <Layout header={<NetworkPill />}>
      <main class="bp-settings">
        <h1>{t('settings.network.pick.title')}</h1>
        <p>{t('settings.network.pick.body', { network: t('settings.network.testnet') })}</p>
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
            navigate({ name: 'settings.main' });
          }}
        >
          {t('settings.network.pick.switch')}
        </Button>
      </main>
    </Layout>
  );
}
