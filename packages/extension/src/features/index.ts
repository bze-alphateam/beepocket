import { onboardingRoutes, type OnboardingRoute } from './onboarding';
import { bookRoutes, type BookRoute } from './address-book/routes';
import { homeRoutes, type HomeRoute } from './home/routes';
import { shellRoutes, type ShellRoute } from './shell/routes';
import { settingsRoutes, type SettingsRoute } from './settings/routes';
import { sendRoutes, type SendRoute } from './send/routes';
import type { RouteTable } from '../popup/router';
import { lockRoutes, type LockRoute } from './lock/routes';
import { dappRoutes, type DappRoute } from './dapp/routes';

/**
 * Every route of the popup. A feature adds its union here and its table below: one line each.
 * `export type AppRoute = ShellRoute | WalletRoute | ...`
 */
export type AppRoute =
  | ShellRoute
  | HomeRoute
  | LockRoute
  | BookRoute
  | OnboardingRoute
  | SettingsRoute
  | SendRoute
  | DappRoute;

export const routeTable: RouteTable<AppRoute> = {
  ...shellRoutes,
  ...homeRoutes,
  ...lockRoutes,
  ...settingsRoutes,
  ...onboardingRoutes,
  ...bookRoutes,
  ...sendRoutes,
  ...dappRoutes,
};

export const initialRoute: AppRoute = { name: 'lock.root' };

/** The request window (`popup.html?window=request`) opens on its own route; the popup does not. */
export function isRequestWindow(search: string): boolean {
  return new URLSearchParams(search).get('window') === 'request';
}

export function initialRouteFor(search: string): AppRoute {
  return isRequestWindow(search) ? { name: 'dapp.request' } : initialRoute;
}
