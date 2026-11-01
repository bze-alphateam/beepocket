import type { RouteTable } from '../../popup/router';
import { StateRoot } from './StateSupervisor';
import { UnlockScreen } from './UnlockScreen';

export type LockRoute = { name: 'lock.root' } | { name: 'lock.unlock' };

export const lockRoutes: RouteTable<LockRoute> = {
  'lock.root': StateRoot,
  'lock.unlock': UnlockScreen,
};
