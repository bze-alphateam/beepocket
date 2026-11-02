import { addressBook } from './book';
import { app } from './app';
import { settings } from './settings';
import { onboarding } from './onboarding';
import { home } from './home';
import { lock } from './lock';
import { send } from './send';
import { activity } from './activity';
import { dapp } from './dapp';

/**
 * The one entry point for English strings. A feature adds `src/i18n/<feature>.ts` (keys
 * prefixed `<feature>.`) and one spread line here; nothing else is shared between features.
 */
export const en = {
  ...app,
  ...settings,
  ...onboarding,
  ...addressBook,
  ...home,
  ...lock,
  ...send,
  ...activity,
  ...dapp,
} as const;

export type StringKey = keyof typeof en;
