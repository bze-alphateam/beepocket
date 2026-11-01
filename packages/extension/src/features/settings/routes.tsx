import type { RouteTable } from '../../popup/router';
import { chromeManifest } from './manifest';
import { PickTokensScreen } from './PickTokensScreen';
import { SettingsScreen } from './SettingsScreen';

export type SettingsRoute = { name: 'settings.main' } | { name: 'settings.pickTokens' };

function SettingsMain() {
  return <SettingsScreen manifest={chromeManifest} />;
}

export const settingsRoutes: RouteTable<SettingsRoute> = {
  'settings.main': SettingsMain,
  'settings.pickTokens': PickTokensScreen,
};
