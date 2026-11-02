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

  const refresh = useCallback(async () => {
    const res = await client.call('dapp.current', {});
    if (!res.ok) {
      setLoad({ status: 'failed' });
      return;
    }
    if (res.value.status === 'none') {
      if (!closed.current) {
        closed.current = true;
        close();
      }
      return;
    }
    setLoad({ status: 'ready', view: res.value });
  }, [client, close]);

  useEffect(() => {
    void refresh();
    // Any change of the lock (here or in the toolbar popup) can change what the head needs.
    return events.subscribe(() => {
      void refresh();
    });
  }, [events, refresh]);

  const ready = load.status === 'ready' ? load.view : null;
  const expiresAt = ready?.status === 'none' ? undefined : ready?.expiresAt;
  // An expired request leaves the view by itself; the worker answers it `expired`.
  useEffect(() => {
    if (expiresAt === undefined) return undefined;
    return scheduler.after(Math.max(expiresAt - clock.now(), 0) + 50, () => void refresh());
  }, [expiresAt, scheduler, clock, refresh]);
  useEffect(() => () => cancelNext.current(), []);

  // After an answer: with more waiting, a short "Next request" state, then the next one.
  const answered = () => {
    const waiting = (ready?.status === 'none' ? 1 : ready?.count) ?? 1;
    if (waiting <= 1) {
      void refresh();
      return;
    }
    setNext(waiting - 1);
    cancelNext.current = scheduler.after(NEXT_MS, () => {
      setNext(null);
      void refresh();
    });
  };

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
          <QueuePill count={view.count} />
          <ConnectScreen view={view} done={answered} />
        </>
      );
    case 'sign':
      return (
        <>
          <QueuePill count={view.count} />
          <SignScreen view={view} done={answered} />
        </>
      );
    case 'none':
      return null;
  }
}
