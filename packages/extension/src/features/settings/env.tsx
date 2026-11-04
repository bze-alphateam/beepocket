import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Scheduler } from '../home/env';
import { browserClipboardRead } from '../../popup/clipboard';
import { chromeManifest, type ManifestSource } from './manifest';

/**
 * What Settings needs from the browser: the version for the footer, the clipboard for Copy and
 * the token denom's Paste (read only on that tap, asking for `clipboardRead` when it is not held;
 * a refusal rejects), the timer that debounces the code lookup.
 */
export interface SettingsEnv {
  manifest: ManifestSource;
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> };
  scheduler: Pick<Scheduler, 'after'>;
}

/** All are only touched when used, so building this needs no `chrome` (tests, previews). */
export const browserSettingsEnv: SettingsEnv = {
  manifest: chromeManifest,
  clipboard: {
    readText: browserClipboardRead,
    writeText: (text) => navigator.clipboard.writeText(text),
  },
  scheduler: {
    after: (ms, fn) => {
      const id = setTimeout(fn, ms);
      return () => {
        clearTimeout(id);
      };
    },
  },
};

const SettingsEnvContext = createContext<SettingsEnv>(browserSettingsEnv);

export function SettingsEnvProvider(props: { env: SettingsEnv; children: ComponentChildren }) {
  return (
    <SettingsEnvContext.Provider value={props.env}>{props.children}</SettingsEnvContext.Provider>
  );
}

export function useSettingsEnv(): SettingsEnv {
  return useContext(SettingsEnvContext);
}
