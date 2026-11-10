import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { registerActivityTab } from '../activity/tab';
import { useAppearance } from '../../popup/appearance';
import { browserHomeEnv, HomeEnvProvider } from './env';
import { Home, type HomeRoute } from './Home';

export type { HomeRoute } from './Home';

registerActivityTab();

function HomeScreen() {
  const scheme = useAppearance();
  const env = useMemo(() => browserHomeEnv(scheme), [scheme]);
  return (
    <HomeEnvProvider env={env}>
      <Home />
    </HomeEnvProvider>
  );
}

export const homeRoutes: RouteTable<HomeRoute> = { 'home.main': HomeScreen };
