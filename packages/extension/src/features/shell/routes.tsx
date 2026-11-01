import { version } from '@beepocket/core';
import { Layout } from '../../popup/Layout';
import type { RouteTable } from '../../popup/router';
import { t } from '../../i18n';

export interface ShellRoute {
  name: 'shell.home';
}

function Home() {
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
