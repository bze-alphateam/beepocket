import { version } from '@beepocket/core';
import { useEffect } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import type { AppRoute } from '..';
import { Layout } from '../../popup/Layout';
import type { RouteTable } from '../../popup/router';
import { t } from '../../i18n';

export interface ShellRoute {
  name: 'shell.home';
}

function Home() {
  const client = useClient();
  const { navigate } = useRoute<AppRoute>();
  // The shell routes by wallet state: a fresh install opens the first-run flow.
  useEffect(() => {
    void client.call('wallet.state', {}).then((res) => {
      if (res.ok && res.value.state === 'uninitialised') navigate({ name: 'onboarding' });
    });
  }, [client, navigate]);
  return (
    <Layout>
      <main class="bp-splash">
        <img src="icons/icon-48.png" width="48" height="48" alt="" />
        <h1>{t('app.name')}</h1>
        <small>{t('app.version', { version })}</small>
      </main>
    </Layout>
  );
}

export const shellRoutes: RouteTable<ShellRoute> = { 'shell.home': Home };
