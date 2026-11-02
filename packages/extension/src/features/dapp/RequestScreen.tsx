import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import type { RequestView } from '../../protocol';
import { Banner, Button, Spinner } from '../../ui';
import { PasswordGate } from '../lock/PasswordGate';
import { useLockEnv } from '../lock/env';
import { UnlockPanel } from '../lock/UnlockScreen';
import { ConnectScreen } from './ConnectScreen';
import { SignScreen } from './SignScreen';

export interface RequestScreenProps {
  /** Closes the window (`window.close()`); called when nothing waits any more. */
  close: () => void;
}

type Load = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; view: RequestView };

/**
 * The request window: shows the request that waits. The worker decides what that is, so a
 * lock that happens while the window is open (or an unlock) just asks the worker again.
 */
export function RequestScreen({ close }: RequestScreenProps) {
  const client = useClient();
  const { events } = useLockEnv();
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
    return events.subscribe((e) => {
      if (e.state === 'locked') void refresh();
    });
  }, [events, refresh]);

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
      return <ConnectScreen view={view} done={() => void refresh()} />;
    case 'sign':
      return <SignScreen view={view} done={() => void refresh()} />;
    case 'none':
      return null;
  }
}
