import type { RouteBase } from '../../popup/router';

/**
 * Where the state routing sends the user. The home and onboarding stories own these screens;
 * the names are the contract between the stories.
 */
export const homeTarget: RouteBase = { name: 'shell.home' };
export const onboardingTarget: RouteBase = { name: 'onboarding.welcome' };
export const importTarget: RouteBase = { name: 'onboarding.import' };
export const unlockTarget: RouteBase = { name: 'lock.unlock' };
