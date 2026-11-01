import type { RouteTable } from '../../popup/router';
import { Onboarding } from './Onboarding';

/** The names are the contract with the state routing of the unlock story. */
export type OnboardingRoute =
  | {
      name: 'onboarding.welcome';
      /** Pre-fills the token-code field; the add-a-token link uses it. */
      prefillCode?: string;
    }
  | { name: 'onboarding.import'; prefillCode?: string };

export const onboardingRoutes: RouteTable<OnboardingRoute> = {
  'onboarding.welcome': Onboarding,
  'onboarding.import': Onboarding,
};
