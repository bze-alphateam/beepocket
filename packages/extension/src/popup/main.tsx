import { render } from 'preact';
import { RandomProvider } from '../features/onboarding';
import { CryptoRandom } from '../platform';
import { SystemClock } from '@beepocket/core';
import { RuntimeClient } from '../protocol/client';
import { AppearanceState, applyTheme } from '../theme';
import { LockEnvProvider, RuntimeStateEvents } from '../features/lock';
import { initialRouteFor } from '../features';
import { App } from './App';
import { AppearanceProvider } from './appearance';
import { ClientProvider } from './client-context';

const client = new RuntimeClient(chrome.runtime);
const appearance = new AppearanceState(window.matchMedia('(prefers-color-scheme: dark)'), (value) =>
  client.call('appearance.set', { appearance: value }),
);

// The BeePocket look until a screen applies its token kit. Subscribed first, so a screen that
// re-applies its kit on a scheme change runs after this and wins.
const theme = () => {
  applyTheme(document.documentElement, {
    denom: null,
    branding: null,
    brandThemes: true,
    scheme: appearance.current(),
  });
};
theme();
appearance.subscribe(theme);
// Dark until the stored setting arrives (the default); a failed read keeps the default.
void client.call('appearance.get', {}).then((res) => {
  if (res.ok) appearance.load(res.value.appearance);
});

const root = document.getElementById('root');
if (root) {
  render(
    <ClientProvider client={client}>
      <AppearanceProvider state={appearance}>
        <RandomProvider random={new CryptoRandom(crypto)}>
          <LockEnvProvider
            clock={new SystemClock()}
            events={new RuntimeStateEvents(chrome.runtime.onMessage)}
          >
            <App initial={initialRouteFor(window.location.search)} />
          </LockEnvProvider>
        </RandomProvider>
      </AppearanceProvider>
    </ClientProvider>,
    root,
  );
}
