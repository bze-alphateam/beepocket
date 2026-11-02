import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import type { CurrentRequest } from '../../protocol';
import { Banner, Button, Spinner } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { useHomeEnv } from '../home/env';
import { useLockEnv } from '../lock/env';
import { UnlockPanel } from '../lock/UnlockScreen';
import { ConnectScreen } from './ConnectScreen';
import { SignScreen } from './SignScreen';

export interface RequestScreenProps {
  /** Closes the window (`window.close()`); called when nothing waits any more. */
  close: () => void;
}

const NEXT_MS = 600;
const POLL_MS = 1_000;

/** "1 of N" while more than one request waits; the head is always the first. */
function QueuePill({ count }: { count: number | undefined }) {
  if (count === undefined || count < 2) return null;
  return (
    <span class="bp-dapp-pill" aria-label={t('dapp.queue.pill', { n: '1', count: String(count) })}>
      {t('dapp.queue.pill', { n: '1', count: String(count) })}
    </span>
  );
}

type Load =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; view: CurrentRequest };

/**
 * The request window: shows the request that waits. The worker decides what that is, so a
 * lock that happens while the window is open (or an unlock) just asks the worker again.
 */
export function RequestScreen({ close }: RequestScreenProps) {
  const client = useClient();
  const { events, clock } = useLockEnv();
  const { scheduler } = useHomeEnv();
  // The "Next request" state: how many wait behind the one just answered.
  const [next, setNext] = useState<number | null>(null);
  const cancelNext = useRef<() => void>(() => undefined);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const closed = useRef(false);

  // Requests that arrive while one is on screen only change the count, never the view.
  const [live, setLive] = useState<number | null>(null);

  /** `from` is the request just answered: when another one takes its place, "Next request" shows first. */
  const refresh = useCallback(
    async (from?: string) => {
      const res = await client.call('dapp.current', {});
      if (!res.ok) {
        setLoad({ status: 'failed' });
        return;
      }
      const view = res.value;
      if (view.status === 'none') {
        if (!closed.current) {
          closed.current = true;
          close();
        }
        return;
      }
      setLive(null);
      setLoad({ status: 'ready', view });
      if (
        (view.status === 'connect' || view.status === 'sign') &&
        from !== undefined &&
        view.id !== from
      ) {
        setNext(view.count ?? 1);
        cancelNext.current = scheduler.after(NEXT_MS, () => {
          setNext(null);
        });
      }
    },
    [client, close, scheduler],
  );

  useEffect(() => {
    void refresh();
    // Any change of the lock (here or in the toolbar popup) can change what the head needs.
    return events.subscribe(() => {
      void refresh();
    });
  }, [events, refresh]);

  const ready = load.status === 'ready' ? load.view : null;
  const expiresAt = ready?.expiresAt;
  // An expired request leaves the view by itself; the worker answers it `expired`.
  useEffect(() => {
    if (expiresAt === undefined) return undefined;
    return scheduler.after(Math.max(expiresAt - clock.now(), 0) + 50, () => void refresh());
  }, [expiresAt, scheduler, clock, refresh]);
  useEffect(() => () => cancelNext.current(), []);
  // The window hears about requests queued behind the one on screen by asking now and then.
  useEffect(
    () =>
      scheduler.every(POLL_MS, () => {
        void client.call('dapp.queue', {}).then((res) => {
          if (!res.ok) return;
          if (res.value.count === 0) void refresh();
          else setLive(res.value.count);
        });
      }),
    [client, scheduler, refresh],
  );
  const count = live ?? ready?.count;

  if (next !== null) {
    return (
      <Layout>
        <div class="bp-dapp-center">
          <p role="status">{t('dapp.queue.next', { n: String(next) })}</p>
        </div>
      </Layout>
    );
  }
  if (load.status === 'loading') {
    return (
      <Layout>
        <div class="bp-dapp-center">
          <Spinner />
        </div>
      </Layout>
    );
  }
  if (load.status === 'failed') {
    return (
      <Layout>
        <div class="bp-dapp-center">
          <Banner tone="red">{t('dapp.failed')}</Banner>
          <Button
            onClick={() => {
              setLoad({ status: 'loading' });
              void refresh();
            }}
          >
            {t('dapp.retry')}
          </Button>
        </div>
      </Layout>
    );
  }
  const view = load.view;
  switch (view.status) {
    case 'locked':
      return (
        <UnlockPanel
          noImport
          subtitle={t('dapp.locked.subtitle', { site: view.origin })}
          onUnlocked={() => void refresh()}
        />
      );
    case 'unlock':
      return (
        <Layout>
          <main class="bp-dapp">
            <h1>{t('dapp.unlock.title', { site: view.origin })}</h1>
            <p class="bp-dapp-sub">{t('dapp.unlock.sub')}</p>
            <PasswordGate onUnlocked={() => void refresh()} />
          </main>
        </Layout>
      );
    case 'connect':
      return (
        <>
          <QueuePill count={count} />
          <ConnectScreen view={view} done={() => void refresh(view.id)} />
        </>
      );
    case 'sign':
      return (
        <>
          <QueuePill count={count} />
          <SignScreen view={view} done={() => void refresh(view.id)} />
        </>
      );
    case 'none':
      return null;
  }
}
