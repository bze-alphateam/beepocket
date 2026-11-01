import { render } from 'preact';
import { SystemClock } from '@beepocket/core';
import { RuntimeClient } from '../protocol/client';
import { applyTheme, systemScheme } from '../theme';
import { LockEnvProvider, RuntimeStateEvents } from '../features/lock';
import { App } from './App';
import { ClientProvider } from './client-context';

const dark = window.matchMedia('(prefers-color-scheme: dark)');
const theme = () => {
  // Token and brand-kit selection arrive with the wallet stories; until then: BeePocket look.
  applyTheme(document.documentElement, {
    denom: null,
    branding: null,
    brandThemes: true,
    scheme: systemScheme(dark),
  });
};
theme();
dark.addEventListener('change', theme);

const root = document.getElementById('root');
if (root) {
  render(
    <ClientProvider client={new RuntimeClient(chrome.runtime)}>
      <LockEnvProvider
        clock={new SystemClock()}
        events={new RuntimeStateEvents(chrome.runtime.onMessage)}
      >
        <App />
      </LockEnvProvider>
    </ClientProvider>,
    root,
  );
}
