import { useEffect, useRef, useState } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import type { Client } from '../../protocol/client';
import { useRoute } from '../../popup/router';
import type { WalletState } from '../../protocol';
import { useLockEnv } from './env';
import {
  addTokenTarget,
  homeTarget,
  onboardingTarget,
  requestTarget,
  unlockTarget,
} from './targets';
import { useActivityPing } from './useActivityPing';

/**
 * Mounted once under the router: follows the worker's state pushes (a full lock by alarm
 * switches to the unlock screen without a reload) and pings activity while unlocked.
 */
export function StateSupervisor() {
  const client = useClient();
  const { events } = useLockEnv();
  const { route, navigate } = useRoute();
  const routeName = useRef(route.name);
  routeName.current = route.name;
  const [state, setState] = useState<WalletState | null>(null);
  useActivityPing(state === 'unlocked' || state === 'weakLocked');

  useEffect(() => {
    const off = events.subscribe((e) => {
      setState(e.state);
      // The request screen asks for the password in place and keeps the request on screen.
      if (e.state === 'locked' && routeName.current !== requestTarget.name) navigate(unlockTarget);
      else if (
        (e.state === 'unlocked' || e.state === 'weakLocked') &&
        routeName.current === unlockTarget.name
      ) {
        navigate(homeTarget);
      }
    });
    void client.call('wallet.state', {}).then((res) => {
      if (res.ok) setState((current) => current ?? res.value.state);
    });
    return off;
  }, [client, events, navigate]);
  return null;
}

/**
 * First route: reads the wallet state and routes to onboarding, unlock or the wallet. What waits
 * comes first, so a popup the browser opened for it (or the icon clicked again) shows it: an
 * add-a-token link in any state (its screen follows the wallet), a dapp request once unlocked
 * (the unlock screen names who waits and continues to it).
 */
export function StateRoot() {
  const client = useClient();
  const { navigate } = useRoute();
  useEffect(() => {
    void (async () => {
      const res = await client.call('wallet.state', {});
      if (!res.ok) {
        navigate(unlockTarget);
        return;
      }
      const link = await client.call('addtoken.current', {});
      if (link.ok && link.value.status === 'link') {
        navigate(addTokenTarget);
        return;
      }
      const { state } = res.value;
      if (state === 'uninitialised') navigate(onboardingTarget);
      else if (state === 'locked') navigate(unlockTarget);
      else navigate((await hasRequests(client)) ? requestTarget : homeTarget);
    })();
  }, [client, navigate]);
  return null;
}

/** Whether a dapp request waits; a failed read counts as none. */
export async function hasRequests(client: Client): Promise<boolean> {
  const queue = await client.call('dapp.queue', {});
  return queue.ok && queue.value.count > 0;
}
