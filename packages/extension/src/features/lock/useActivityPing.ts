import { useEffect } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import { useLockEnv } from './env';

export const PING_INTERVAL_MS = 10_000;

/**
 * Tells the worker the user is active (restarting the lock timers): `wallet.touch` on
 * pointerdown or keydown, at most once per 10 s. Does nothing while `enabled` is false.
 */
export function useActivityPing(enabled: boolean): void {
  const client = useClient();
  const { clock } = useLockEnv();
  useEffect(() => {
    if (!enabled) return undefined;
    let last = Number.NEGATIVE_INFINITY;
    const ping = () => {
      const now = clock.now();
      if (now - last < PING_INTERVAL_MS) return;
      last = now;
      void client.call('wallet.touch', {});
    };
    document.addEventListener('pointerdown', ping, true);
    document.addEventListener('keydown', ping, true);
    return () => {
      document.removeEventListener('pointerdown', ping, true);
      document.removeEventListener('keydown', ping, true);
    };
  }, [client, clock, enabled]);
}
