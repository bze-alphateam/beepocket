import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { registerActivityTab } from '../activity/tab';
import { useAppearance } from '../../popup/appearance';
import { browserHomeEnv, HomeEnvProvider } from './env';
import { Home, type HomeRoute, type SettingsTarget } from './Home';

export type { HomeRoute, SettingsTarget } from './Home';

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

/** `settings.main` is Home with the Settings sheet open; Home reads the route name. */
export const homeRoutes: RouteTable<HomeRoute | SettingsTarget> = {
  'home.main': HomeScreen,
  'settings.main': HomeScreen,
};
