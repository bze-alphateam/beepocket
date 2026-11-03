import { t } from '../../i18n';

/** The lock times Settings offers, in minutes. `settings.set` accepts only these. */
export const LOCK_CHOICES: readonly number[] = [
  1, 2, 5, 10, 15, 30, 60, 120, 240, 480, 1440, 10080,
];

export function isLockChoice(n: unknown): n is number {
  return typeof n === 'number' && LOCK_CHOICES.includes(n);
}

/** "15 min", "1 h", "7 d". */
export function minutesLabel(n: number): string {
  if (n % 1440 === 0) return t('settings.days', { count: n / 1440 });
  if (n % 60 === 0) return t('settings.hours', { count: n / 60 });
  return t('settings.minutes', { count: n });
}
