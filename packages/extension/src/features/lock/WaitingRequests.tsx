import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import type { QueueView } from '../../protocol';

/** The "<site> is waiting" card of the unlock screen: who waits, never what they ask. */
export function WaitingRequests() {
  const client = useClient();
  const [queue, setQueue] = useState<QueueView | null>(null);

  useEffect(() => {
    let live = true;
    void client.call('dapp.queue', {}).then((res) => {
      if (live && res.ok) setQueue(res.value);
    });
    return () => {
      live = false;
    };
  }, [client]);

  if (queue?.head == null || !(queue.count > 0)) return null;
  const more = queue.origins.length - 1;
  return (
    <aside class="bp-lock-waiting" role="note">
      <strong>
        {more > 0
          ? t('dapp.waiting.many', { site: queue.head, n: String(more) })
          : t('dapp.waiting.one', { site: queue.head })}
      </strong>
      <span>{t(more > 0 ? 'dapp.waiting.subMany' : 'dapp.waiting.sub')}</span>
    </aside>
  );
}
