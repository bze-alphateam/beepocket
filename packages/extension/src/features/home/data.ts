import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Client } from '../../protocol/client';
import type { ListedToken, TokenBalances } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { useHomeEnv } from './env';

export const REFRESH_MS = 15_000;

export interface Balances {
  balances: TokenBalances | null;
  /** The last read failed (the previous numbers, if any, stay on screen). */
  failed: boolean;
  /** Reads again now, skipping the service's freshness window. */
  refresh: () => Promise<void>;
}

/**
 * One token's balances: read when the denom changes, every 15 s while mounted and on
 * `refresh()` (the send story calls it after a broadcast). The interval dies with the screen.
 */
export function useBalances(denom: string | null): Balances {
  const client = useClient();
  const { scheduler } = useHomeEnv();
  const [balances, setBalances] = useState<TokenBalances | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const inFlight = useRef(0);

  const read = useCallback(
    async (force: boolean) => {
      if (denom === null) return;
      const id = ++latest.current;
      inFlight.current++;
      const res = await client
        .call('tokens.balances', force ? { denom, refresh: true } : { denom })
        .finally(() => {
          inFlight.current--;
        });
      if (id !== latest.current) return;
      if (res.ok) {
        setBalances(res.value);
        setFailed(false);
      } else setFailed(true);
    },
    [client, denom],
  );

  useEffect(() => {
    setBalances(null);
    setFailed(false);
    if (denom === null) return;
    void read(false);
    const stop = scheduler.every(REFRESH_MS, () => {
      if (inFlight.current === 0) void read(false);
    });
    return () => {
      latest.current++;
      stop();
    };
  }, [denom, read, scheduler]);

  const refresh = useCallback(() => read(true), [read]);
  return { balances, failed, refresh };
}

export async function loadBalancesFor(client: Client, tokens: ListedToken[]) {
  const entries = await Promise.all(
    tokens.map(async (t) => {
      const res = await client.call('tokens.balances', { denom: t.denom });
      return [t.denom, res.ok ? res.value : null] as const;
    }),
  );
  return new Map(entries);
}
