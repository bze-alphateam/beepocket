import { onboardingRoutes, type HomePlaceholderRoute, type OnboardingRoute } from './onboarding';
import { shellRoutes, type ShellRoute } from './shell/routes';
import type { RouteTable } from '../popup/router';

/**
 * Every route of the popup. A feature adds its union here and its table below: one line each.
 * `export type AppRoute = ShellRoute | WalletRoute | ...`
 */
export type AppRoute = ShellRoute | OnboardingRoute | HomePlaceholderRoute;

export const routeTable: RouteTable<AppRoute> = { ...shellRoutes, ...onboardingRoutes };

export const initialRoute: AppRoute = { name: 'shell.home' };
