import { useMemo } from 'preact/hooks';
import { useAppearance } from '../../popup/appearance';
import type { RouteTable } from '../../popup/router';
import { browserHomeEnv } from '../home/env';
import { SendEnvProvider } from './env';
import { SendFlow, type SendRoute } from './SendFlow';

export type { SendRoute } from './SendFlow';

function SendScreen({ route }: { route: SendRoute }) {
  const scheme = useAppearance();
  const env = useMemo(() => browserHomeEnv(scheme), [scheme]);
  return (
    <SendEnvProvider env={env}>
      <SendFlow route={route} />
    </SendEnvProvider>
  );
}

export const sendRoutes: RouteTable<SendRoute> = { send: SendScreen };
