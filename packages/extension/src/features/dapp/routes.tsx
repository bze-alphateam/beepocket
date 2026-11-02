import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { useAppearance } from '../../popup/appearance';
import { browserHomeEnv, HomeEnvProvider } from '../home/env';
import { ConnectedSitesScreen } from './ConnectedSitesScreen';
import { RequestScreen } from './RequestScreen';

export interface DappRoute {
  name: 'dapp.request' | 'dapp.sites';
}

function RequestRoute() {
  const scheme = useAppearance();
  const env = useMemo(() => browserHomeEnv(scheme), [scheme]);
  return (
    <HomeEnvProvider env={env}>
      <RequestScreen
        close={() => {
          window.close();
        }}
      />
    </HomeEnvProvider>
  );
}

export const dappRoutes: RouteTable<DappRoute> = {
  'dapp.request': RequestRoute,
  'dapp.sites': ConnectedSitesScreen,
};
