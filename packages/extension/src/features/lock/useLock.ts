import { useCallback } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import { unlockTarget } from './targets';

/** Manual lock: locks the wallet and shows the unlock screen. Used by the home header. */
export function useLock(): () => Promise<void> {
  const client = useClient();
  const { navigate } = useRoute();
  return useCallback(async () => {
    const res = await client.call('wallet.lock', {});
    if (res.ok) navigate(unlockTarget);
  }, [client, navigate]);
}
