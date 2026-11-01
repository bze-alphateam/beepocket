import { onboardingRoutes, type OnboardingRoute } from './onboarding';
import { shellRoutes, type ShellRoute } from './shell/routes';
import type { RouteTable } from '../popup/router';
import { lockRoutes, type LockRoute } from './lock/routes';

/**
 * Every route of the popup. A feature adds its union here and its table below: one line each.
 * `export type AppRoute = ShellRoute | WalletRoute | ...`
 */
export type AppRoute = ShellRoute | LockRoute | OnboardingRoute;

export const routeTable: RouteTable<AppRoute> = {
  ...shellRoutes,
  ...lockRoutes,
  ...onboardingRoutes,
};

export const initialRoute: AppRoute = { name: 'lock.root' };
