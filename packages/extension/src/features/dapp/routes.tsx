import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { browserHomeEnv, HomeEnvProvider } from '../home/env';
import { RequestScreen } from './RequestScreen';

export interface DappRoute {
  name: 'dapp.request';
}

function RequestRoute() {
  const env = useMemo(browserHomeEnv, []);
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

export const dappRoutes: RouteTable<DappRoute> = { 'dapp.request': RequestRoute };
