import { render } from 'preact';
import { RandomProvider } from '../features/onboarding';
import { CryptoRandom } from '../platform';
import { SystemClock } from '@beepocket/core';
import { RuntimeClient } from '../protocol/client';
import { AppearanceState, applyTheme, LocalAppearanceCache } from '../theme';
import { LockEnvProvider, RuntimeStateEvents } from '../features/lock';
import { initialRouteFor, isWalletWindow } from '../features';
import { App } from './App';
import { AppearanceProvider } from './appearance';
import { ClientProvider } from './client-context';
import { fitWalletWindow } from './fit-window';

// A wallet window fills its viewport, so the pinned footer stays on screen whatever the frame
// around it, and grows itself to the intended inner 360 × 600.
if (isWalletWindow(window.location.search)) {
  document.documentElement.dataset.window = '';
  void fitWalletWindow(window, chrome.windows).catch(() => undefined);
}

const client = new RuntimeClient(chrome.runtime);
const appearance = new AppearanceState(window.matchMedia('(prefers-color-scheme: dark)'), {
  save: (value) => client.call('appearance.set', { appearance: value }),
  // The last value seen in this browser: the first paint already has the right scheme.
  cache: new LocalAppearanceCache(() => window.localStorage),
});

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
// No colour fade while the page boots, including a correction from the stored value below.
document.documentElement.dataset.booting = '';
theme();
appearance.subscribe(theme);
// The worker's stored value wins over the cached copy; a failed read keeps what is shown.
void client
  .call('appearance.get', {})
  .then((res) => {
    if (res.ok) appearance.load(res.value.appearance);
  })
  .finally(() => {
    requestAnimationFrame(() => {
      delete document.documentElement.dataset.booting;
    });
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
