import { useEffect, useRef, useState } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import type { WalletState } from '../../protocol';
import { useLockEnv } from './env';
import { homeTarget, onboardingTarget, unlockTarget } from './targets';
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
      if (e.state === 'locked') navigate(unlockTarget);
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

/** First route: reads the wallet state and routes to onboarding, unlock or the wallet. */
export function StateRoot() {
  const client = useClient();
  const { navigate } = useRoute();
  useEffect(() => {
    void client.call('wallet.state', {}).then((res) => {
      if (!res.ok) {
        navigate(unlockTarget);
        return;
      }
      const { state } = res.value;
      if (state === 'uninitialised') navigate(onboardingTarget);
      else if (state === 'locked') navigate(unlockTarget);
      else navigate(homeTarget);
    });
  }, [client, navigate]);
  return null;
}
