import { render } from 'preact';
import { RuntimeClient } from '../protocol/client';
import { applyTheme, systemScheme } from '../theme';
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
      <App />
    </ClientProvider>,
    root,
  );
}
