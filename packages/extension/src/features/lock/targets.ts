import type { RouteBase } from '../../popup/router';

/**
 * Where the state routing sends the user. The home and onboarding stories own these screens;
 * the names are the contract between the stories.
 */
export const homeTarget: RouteBase = { name: 'home.main' };
export const onboardingTarget: RouteBase = { name: 'onboarding.welcome' };
export const importTarget: RouteBase = { name: 'onboarding.import' };
export const unlockTarget: RouteBase = { name: 'lock.unlock' };
/** The queue head, shown in the toolbar popup too; it follows the lock state itself. */
export const requestTarget: RouteBase = { name: 'dapp.request' };
export const addTokenTarget: RouteBase = { name: 'addtoken.main' };
