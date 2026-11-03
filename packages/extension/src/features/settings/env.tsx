import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { chromeManifest, type ManifestSource } from './manifest';

/** What Settings needs from the browser: the version for the footer, the clipboard for Copy. */
export interface SettingsEnv {
  manifest: ManifestSource;
  clipboard: { writeText(text: string): Promise<void> };
}

/** Both are only touched when used, so building this needs no `chrome` (tests, previews). */
export const browserSettingsEnv: SettingsEnv = {
  manifest: chromeManifest,
  clipboard: { writeText: (text) => navigator.clipboard.writeText(text) },
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
