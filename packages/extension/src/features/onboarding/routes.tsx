import { useMemo } from 'preact/hooks';
import type { RouteTable } from '../../popup/router';
import { browserOnboardingEnv, OnboardingEnvProvider, useOptionalOnboardingEnv } from './env';
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

/** Uses the env a provider hands in (tests), else the browser's. */
function OnboardingScreen({ route }: { route: OnboardingRoute }) {
  const given = useOptionalOnboardingEnv();
  const env = useMemo(() => given ?? browserOnboardingEnv(), [given]);
  return (
    <OnboardingEnvProvider env={env}>
      <Onboarding route={route} />
    </OnboardingEnvProvider>
  );
}

export const onboardingRoutes: RouteTable<OnboardingRoute> = {
  'onboarding.welcome': OnboardingScreen,
  'onboarding.import': OnboardingScreen,
};
