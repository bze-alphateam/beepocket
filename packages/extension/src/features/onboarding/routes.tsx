import type { RouteTable } from '../../popup/router';
import { Onboarding } from './Onboarding';

/** The names are the contract with the state routing of the unlock story. */
export interface LinkOrigin {
  /** Display text only: the linking site's host. */
  host: string | null;
  /** False shows the amber "Anyone can make a token" line on the token-code step. */
  known: boolean;
}

export type OnboardingRoute =
  | {
      name: 'onboarding.welcome';
      /** Pre-fills the token-code field; the add-a-token link uses it. */
      prefillCode?: string;
      /** Set when the code came from an add-a-token link. */
      link?: LinkOrigin;
    }
  | { name: 'onboarding.import'; prefillCode?: string; link?: LinkOrigin };

export const onboardingRoutes: RouteTable<OnboardingRoute> = {
  'onboarding.welcome': Onboarding,
  'onboarding.import': Onboarding,
};
