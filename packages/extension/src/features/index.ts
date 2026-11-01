import { shellRoutes, type ShellRoute } from './shell/routes';
import { settingsRoutes, type SettingsRoute } from './settings/routes';
import type { RouteTable } from '../popup/router';

/**
 * Every route of the popup. A feature adds its union here and its table below: one line each.
 * `export type AppRoute = ShellRoute | WalletRoute | ...`
 */
export type AppRoute = ShellRoute | SettingsRoute;

export const routeTable: RouteTable<AppRoute> = { ...shellRoutes, ...settingsRoutes };

export const initialRoute: AppRoute = { name: 'shell.home' };
