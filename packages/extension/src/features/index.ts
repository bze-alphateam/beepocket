import { shellRoutes, type ShellRoute } from './shell/routes';
import { settingsRoutes, type SettingsRoute } from './settings/routes';
import type { RouteTable } from '../popup/router';
import { lockRoutes, type LockRoute } from './lock/routes';

/**
 * Every route of the popup. A feature adds its union here and its table below: one line each.
 * `export type AppRoute = ShellRoute | WalletRoute | ...`
 */
export type AppRoute = ShellRoute | LockRoute | SettingsRoute;

export const routeTable: RouteTable<AppRoute> = {
  ...shellRoutes,
  ...lockRoutes,
  ...settingsRoutes,
};

export const initialRoute: AppRoute = { name: 'lock.root' };
