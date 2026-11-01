import { useEffect, useState } from 'preact/hooks';
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
  const { navigate } = useRoute();
  const [state, setState] = useState<WalletState | null>(null);
  useActivityPing(state === 'unlocked' || state === 'weakLocked');

  useEffect(() => {
    const off = events.subscribe((e) => {
      setState(e.state);
      if (e.state === 'locked') navigate(unlockTarget);
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
      if (!res.ok) return navigate(unlockTarget);
      const { state } = res.value;
      return navigate(
        state === 'uninitialised'
          ? onboardingTarget
          : state === 'locked'
            ? unlockTarget
            : homeTarget,
      );
    });
  }, [client, navigate]);
  return null;
}
