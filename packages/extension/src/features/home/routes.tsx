import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { registerActivityTab } from '../activity/tab';
import { browserHomeEnv, HomeEnvProvider } from './env';
import { Home, type HomeRoute } from './Home';

export type { HomeRoute } from './Home';

registerActivityTab();

function HomeScreen() {
  const env = useMemo(browserHomeEnv, []);
  return (
    <HomeEnvProvider env={env}>
      <Home />
    </HomeEnvProvider>
  );
}

export const homeRoutes: RouteTable<HomeRoute> = { 'home.main': HomeScreen };
