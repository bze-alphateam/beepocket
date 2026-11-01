import { onboardingRoutes, type OnboardingRoute } from './onboarding';
import { bookRoutes, type BookRoute } from './address-book/routes';
import { homeRoutes, type HomeRoute } from './home/routes';
import { shellRoutes, type ShellRoute } from './shell/routes';
import type { RouteTable } from '../popup/router';
import { lockRoutes, type LockRoute } from './lock/routes';

/**
 * Every route of the popup. A feature adds its union here and its table below: one line each.
 * `export type AppRoute = ShellRoute | WalletRoute | ...`
 */
export type AppRoute = ShellRoute | HomeRoute | LockRoute | BookRoute | OnboardingRoute;

export const routeTable: RouteTable<AppRoute> = {
  ...shellRoutes,
  ...homeRoutes,
  ...lockRoutes,
  ...onboardingRoutes,
  ...bookRoutes,
};

export const initialRoute: AppRoute = { name: 'lock.root' };
