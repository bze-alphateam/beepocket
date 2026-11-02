import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { useAppearance } from '../../popup/appearance';
import { browserHomeEnv, HomeEnvProvider } from '../home/env';
import { AddTokenScreen } from './AddTokenScreen';

export interface AddTokenRoute {
  name: 'addtoken.main';
}

function AddTokenRoot() {
  const scheme = useAppearance();
  const env = useMemo(() => browserHomeEnv(scheme), [scheme]);
  return (
    <HomeEnvProvider env={env}>
      <AddTokenScreen
        close={() => {
          window.close();
        }}
      />
    </HomeEnvProvider>
  );
}

export const addTokenRoutes: RouteTable<AddTokenRoute> = { 'addtoken.main': AddTokenRoot };
