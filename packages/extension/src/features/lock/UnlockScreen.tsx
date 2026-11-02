import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import { Banner, Button, Logo, Spinner } from '../../ui';
import { AppearanceToggle } from '../../popup/appearance';
import { PasswordForm } from './PasswordForm';
import { WaitingRequests } from './WaitingRequests';
import { homeTarget, importTarget } from './targets';

type Load =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; retryAt: number | null };

export interface UnlockPanelProps {
  /** Replaces going to the home screen (the request window continues with its request). */
  onUnlocked?: () => void;
  /** The request window has no way out through Import. */
  noImport?: boolean;
  /** Shows who is waiting for the wallet (the toolbar popup; the request window names it itself). */
  waiting?: boolean;
  /** Names the site that is waiting, under the title. */
  subtitle?: string;
}

/** Full-lock screen: password, throttle countdown, and the quiet way out through Import. */
export function UnlockPanel(props: UnlockPanelProps) {
  const client = useClient();
  const { navigate } = useRoute();
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    void client.call('wallet.state', {}).then((res) => {
      if (!live) return;
      setLoad(res.ok ? { status: 'ready', retryAt: res.value.retryAt } : { status: 'failed' });
    });
    return () => {
      live = false;
    };
  }, [client]);

  return (
    <Layout glow="tall" corner={<AppearanceToggle />}>
      <main class="bp-lock">
        <div class="bp-lock-hero">
          <span class="bp-lock-mark">
            <Logo variant="mark" />
          </span>
          <h1>{t('lock.title')}</h1>
          <p class="bp-lock-sub">{props.subtitle ?? t('lock.subtitle')}</p>
        </div>
        {props.waiting === true && <WaitingRequests />}
        {load.status === 'loading' && <Spinner />}
        {load.status === 'failed' && <Banner tone="red">{t('lock.loadFailed')}</Banner>}
        {load.status === 'ready' && (
          <PasswordForm
            large
            label={t('lock.password')}
            submitLabel={t('lock.unlock')}
            retryAt={load.retryAt}
            check={(password) => client.call('wallet.unlock', { password })}
            onSuccess={() => {
              if (props.onUnlocked) props.onUnlocked();
              else navigate(homeTarget);
            }}
          />
        )}
        {props.noImport !== true && (
          <>
            <Button
              variant="ghost"
              class="bp-lock-forgot"
              onClick={() => {
                navigate(importTarget);
              }}
            >
              {t('lock.forgot')}
            </Button>
            <small class="bp-lock-warning">{t('lock.forgotWarning')}</small>
          </>
        )}
      </main>
    </Layout>
  );
}

/**
 * The unlock route of the popup. With requests waiting, a full lock has no other screen to
 * keep: unlocking opens the request window and closes the popup.
 */
export function UnlockScreen() {
  const client = useClient();
  const { navigate } = useRoute();
  return (
    <UnlockPanel
      waiting
      onUnlocked={() => {
        void client.call('dapp.queue', {}).then(async (queue) => {
          if (queue.ok && queue.value.count > 0 && (await client.call('dapp.open', {})).ok) {
            window.close();
            return;
          }
          navigate(homeTarget);
        });
      }}
    />
  );
}
