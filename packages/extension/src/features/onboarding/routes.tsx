import { Layout } from '../../popup/Layout';
import type { RouteTable } from '../../popup/router';
import { t } from '../../i18n';
import { Onboarding } from './Onboarding';

export interface OnboardingRoute {
  name: 'onboarding';
  /** Pre-fills the token-code field; the add-a-token link uses it. */
  prefillCode?: string;
}

/** Placeholder until the home story registers the real `home` route. */
export interface HomePlaceholderRoute {
  name: 'home';
  denom?: string;
}

function HomePlaceholder() {
  return (
    <Layout>
      <main class="bp-splash">
        <h1>{t('onboarding.home.title')}</h1>
      </main>
    </Layout>
  );
}

export const onboardingRoutes: RouteTable<OnboardingRoute | HomePlaceholderRoute> = {
  onboarding: Onboarding,
  home: HomePlaceholder,
};
