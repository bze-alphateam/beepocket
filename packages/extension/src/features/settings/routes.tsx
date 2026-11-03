import type { RouteTable } from '../../popup/router';
import { PickTokensScreen } from './PickTokensScreen';

/** `settings.main` is Home with the Settings sheet open: the home feature registers it. */
export interface SettingsRoute {
  name: 'settings.pickTokens';
}

export const settingsRoutes: RouteTable<SettingsRoute> = {
  'settings.pickTokens': PickTokensScreen,
};
