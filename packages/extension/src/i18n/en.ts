import { app } from './app';
import { settings } from './settings';
import { home } from './home';
import { lock } from './lock';

/**
 * The one entry point for English strings. A feature adds `src/i18n/<feature>.ts` (keys
 * prefixed `<feature>.`) and one spread line here; nothing else is shared between features.
 */
export const en = {
  ...app,
  ...settings,
  ...home,
  ...lock,
} as const;

export type StringKey = keyof typeof en;
