import { t } from '../../i18n';
import type { FeeChoice } from '../../protocol/send';

/** What the user answered, for the screen shown while the next request loads. */
export type Answer =
  | { kind: 'connect'; approved: boolean; origin: string; label: string }
  | { kind: 'sign'; approved: boolean; origin: string; label: string; fee: FeeChoice };

/** The "1 of N" badge of a request window's header while others wait, else nothing. */
export function requestBadge(
  queue: number | undefined,
): { text: string; label: string } | undefined {
  if (queue === undefined || queue < 2) return undefined;
  const n = { n: '1', count: String(queue) };
  return { text: t('dapp.queue.pill', n), label: t('dapp.queue.label', n) };
}
