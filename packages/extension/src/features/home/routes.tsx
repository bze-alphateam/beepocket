import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { t } from '../../i18n';
import { browserHomeEnv, HomeEnvProvider } from './env';
import { Home, type HomeRoute } from './Home';
import { registerHomeTab } from './tabs';

export type { HomeRoute } from './Home';

// Until the activity story registers its own tab under this id.
registerHomeTab({
  id: 'activity',
  label: t('home.tab.activity'),
  render: () => <p class="bp-home-note">{t('home.tab.activity.soon')}</p>,
});

function HomeScreen() {
  const env = useMemo(browserHomeEnv, []);
  return (
    <HomeEnvProvider env={env}>
      <Home />
    </HomeEnvProvider>
  );
}

export const homeRoutes: RouteTable<HomeRoute> = { 'home.main': HomeScreen };
