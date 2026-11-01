import type { NetworkId } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { Pill } from '../../ui';

/**
 * "Testnet" marker for every header. Shown only off mainnet. Pass `network` when the caller
 * already knows it; otherwise the pill asks the worker once on mount.
 */
export function NetworkPill({ network }: { network?: NetworkId }) {
  const client = useClient();
  const [fetched, setFetched] = useState<NetworkId | null>(null);
  const known = network !== undefined;
  useEffect(() => {
    if (known) return;
    let live = true;
    void client.call('network.get', {}).then((r) => {
      if (live && r.ok) setFetched(r.value.id);
    });
    return () => {
      live = false;
    };
  }, [client, known]);
  const id = network ?? fetched;
  return id === 'testnet' ? <Pill>{t('settings.network.pill.testnet')}</Pill> : null;
}
