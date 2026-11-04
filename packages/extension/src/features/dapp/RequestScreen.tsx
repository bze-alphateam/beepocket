import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import type { CurrentRequest, QueueView } from '../../protocol';
import { Banner, Button, DetailCard, ResultLayout, SiteCard, Spinner } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { useHomeEnv } from '../home/env';
import { useLockEnv } from '../lock/env';
import { UnlockPanel } from '../lock/UnlockScreen';
import { feeText } from '../send/format';
import type { Answer } from './answers';
import { ConnectScreen } from './ConnectScreen';
import { SignScreen } from './SignScreen';

export interface RequestScreenProps {
  /** Closes the window (`window.close()`); called when nothing waits any more. */
  close: () => void;
}

const NEXT_MS = 600;
const POLL_MS = 1_000;

/** The host of an origin, for the result line ("dex.getbze.com shows the result"). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** What was just answered, shown while the next request loads (`W-Sign-Done`, `W-Sign-Next`). */
function Answered({ answer, waiting }: { answer: Answer | null; waiting: number }) {
  const status = (
    <p class="bp-dapp-next" role="status">
      {t('dapp.queue.next', { n: String(waiting) })}
    </p>
  );
  if (answer === null) {
    return (
      <Layout>
        <div class="bp-dapp-center">{status}</div>
      </Layout>
    );
  }
  const site = hostOf(answer.origin);
  const title = !answer.approved
    ? t('dapp.done.rejected')
    : answer.kind === 'sign'
      ? t('dapp.done.approved')
      : t('dapp.done.connected');
  const sub = !answer.approved
    ? t('dapp.done.rejectSub', { site })
    : answer.kind === 'sign'
      ? t('dapp.done.signSub', { site })
      : t('dapp.done.connectSub', { site, label: answer.label });
  return (
    <Layout>
      <ResultLayout
        status={answer.approved ? 'ok' : 'bad'}
        title={title}
        sub={sub}
        actions={status}
      >
        {answer.approved && answer.kind === 'sign' ? (
          <DetailCard
            rows={[
              [t('dapp.done.from'), answer.label],
              [t('dapp.done.fee'), feeText(answer.fee)],
            ]}
          />
        ) : (
          <SiteCard origin={answer.origin} />
        )}
      </ResultLayout>
    </Layout>
  );
}

/** Whether the request on screen is no longer the head of the queue. */
function headLeft(shown: CurrentRequest | null, queue: QueueView): boolean {
  if (shown === null || shown.status === 'none') return false;
  if (shown.status === 'connect' || shown.status === 'sign') {
    return queue.headId !== undefined && queue.headId !== shown.id;
  }
  return queue.head !== shown.origin;
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
  // The "Next request" state: how many wait behind the one just answered, and that answer.
  const [next, setNext] = useState<number | null>(null);
  const answered = useRef<Answer | null>(null);
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
        cancelNext.current();
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
  const shown = useRef<CurrentRequest | null>(null);
  shown.current = ready;
  const expiresAt = ready?.expiresAt;
  // An expired request leaves the view by itself; the worker answers it `expired`.
  useEffect(() => {
    if (expiresAt === undefined) return undefined;
    return scheduler.after(Math.max(expiresAt - clock.now(), 0) + 50, () => {
      void refresh();
    });
  }, [expiresAt, scheduler, clock, refresh]);
  useEffect(
    () => () => {
      cancelNext.current();
    },
    [],
  );
  // The window hears about requests queued behind the one on screen by asking now and then.
  useEffect(
    () =>
      scheduler.every(POLL_MS, () => {
        void client.call('dapp.queue', {}).then((res) => {
          if (!res.ok) return;
          // The request on screen left the queue (its page gave up on it): show the next one.
          if (res.value.count === 0 || headLeft(shown.current, res.value)) void refresh();
          else setLive(res.value.count);
        });
      }),
    [client, scheduler, refresh],
  );
  const count = live ?? ready?.count;
  const answeredThen = (id: string, answer: Answer | undefined) => {
    answered.current = answer ?? null;
    return refresh(id);
  };

  if (next !== null) return <Answered answer={answered.current} waiting={next} />;
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
        <ConnectScreen
          key={view.id}
          view={view}
          queue={count}
          done={(a) => void answeredThen(view.id, a)}
        />
      );
    case 'sign':
      return (
        <SignScreen
          key={view.id}
          view={view}
          queue={count}
          done={(a) => void answeredThen(view.id, a)}
        />
      );
    case 'none':
      return null;
  }
}
