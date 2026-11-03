import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Client } from '../../protocol/client';
import type { ListedToken, TokenBalances } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { useHomeEnv } from './env';

export const REFRESH_MS = 4_000;

export interface Balances {
  balances: TokenBalances | null;
  /** The last read failed (the previous numbers, if any, stay on screen). */
  failed: boolean;
  /** Reads again now, skipping the service's freshness window. */
  refresh: () => Promise<void>;
}

/**
 * One token's balances: read when the denom changes, every 4 s while mounted and visible, and on
 * `refresh()` (the send story calls it after a broadcast). Numbers never blank while a read runs:
 * the last ones stay, and a new token first shows what the worker last read for it. The interval
 * dies with the screen.
 */
export function useBalances(denom: string | null): Balances {
  const client = useClient();
  const { scheduler, visibility } = useHomeEnv();
  const [known, setKnown] = useState<TokenBalances | null>(null);
  const [failed, setFailed] = useState(false);
  // Answers apply in call order: a late answer never replaces a newer one, and nothing called
  // before a token switch (or unmount) applies after it.
  const issued = useRef(0);
  const applied = useRef(0);
  const inFlight = useRef(0);

  const read = useCallback(
    async (force: boolean) => {
      if (denom === null) return;
      const id = ++issued.current;
      inFlight.current++;
      const res = await client
        .call('tokens.balances', force ? { denom, refresh: true } : { denom })
        .finally(() => {
          inFlight.current--;
        });
      if (id <= applied.current) return;
      applied.current = id;
      if (res.ok) {
        setKnown(res.value);
        setFailed(false);
      } else setFailed(true);
    },
    [client, denom],
  );

  useEffect(() => {
    applied.current = issued.current;
    setFailed(false);
    if (denom === null) return;
    const id = ++issued.current;
    void client.call('tokens.lastBalances', { denom }).then((res) => {
      if (id <= applied.current || !res.ok || res.value === null) return;
      applied.current = id;
      setKnown(res.value);
    });
    void read(false);
    const stop = scheduler.every(REFRESH_MS, () => {
      if (inFlight.current === 0 && !visibility.hidden()) void read(false);
    });
    return () => {
      applied.current = issued.current;
      stop();
    };
  }, [client, denom, read, scheduler, visibility]);

  const refresh = useCallback(() => read(true), [read]);
  // Another token's numbers are never shown under this one, not even for a frame.
  return { balances: known?.denom === denom ? known : null, failed, refresh };
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
