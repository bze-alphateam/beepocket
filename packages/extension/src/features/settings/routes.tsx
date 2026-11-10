import type { RouteTable } from '../../popup/router';
import { PickTokensScreen } from './PickTokensScreen';
import { RevealPhrase } from './RevealPhrase';
import {
  SettingsAdvanced,
  SettingsAppearance,
  SettingsConfiguration,
  SettingsMain,
  SettingsSecurity,
  SettingsTimers,
} from './SettingsPages';

/**
 * The Settings tree, every level a full page: main › Configuration (Appearance, Connected sites,
 * Security › Lock timers / recovery phrase, Advanced), Manage tokens and the Address book
 * (registered by the address-book feature).
 */
export interface SettingsRoute {
  name:
    | 'settings.main'
    | 'settings.configuration'
    | 'settings.appearance'
    | 'settings.security'
    | 'settings.timers'
    | 'settings.reveal'
    | 'settings.advanced';
}

/** Manage tokens; `required` when Home sent the user here: no way out until tokens are saved. */
export interface PickTokensRoute {
  name: 'settings.pickTokens';
  required?: boolean;
}

export const settingsRoutes: RouteTable<SettingsRoute | PickTokensRoute> = {
  'settings.main': SettingsMain,
  'settings.configuration': SettingsConfiguration,
  'settings.appearance': SettingsAppearance,
  'settings.security': SettingsSecurity,
  'settings.timers': SettingsTimers,
  'settings.reveal': RevealPhrase,
  'settings.advanced': SettingsAdvanced,
  'settings.pickTokens': PickTokensScreen,
};
