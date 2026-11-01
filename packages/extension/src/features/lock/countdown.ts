import { useEffect, useState } from 'preact/hooks';
import type { Clock } from '@beepocket/core';

/** `m:ss` for a number of milliseconds, rounded up to whole seconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  return `${String(Math.floor(total / 60))}:${seconds}`;
}

/**
 * Milliseconds left until `retryAt` (epoch ms), ticking each second on the injected clock;
 * 0 when there is nothing to wait for. `onDone` fires once when the wait ends.
 */
export function useCountdown(clock: Clock, retryAt: number | null, onDone: () => void): number {
  const [left, setLeft] = useState(() =>
    retryAt === null ? 0 : Math.max(0, retryAt - clock.now()),
  );
  useEffect(() => {
    if (retryAt === null) {
      setLeft(0);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      for (;;) {
        const remaining = retryAt - clock.now();
        if (cancelled) return;
        if (remaining <= 0) {
          setLeft(0);
          onDone();
          return;
        }
        setLeft(remaining);
        await clock.sleep(Math.min(remaining, 1000));
      }
    })();
    return () => {
      cancelled = true;
    };
    // onDone is a state setter in every caller; re-running on it would restart the wait
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, retryAt]);
  return left;
}
