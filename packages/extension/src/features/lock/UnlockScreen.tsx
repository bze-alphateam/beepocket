import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import { Banner, Spinner } from '../../ui';
import { PasswordForm } from './PasswordForm';
import { homeTarget, importTarget } from './targets';

type Load =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; retryAt: number | null };

/** Full-lock screen: password, throttle countdown, and the quiet way out through Import. */
export function UnlockScreen() {
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
    <Layout>
      <main class="bp-lock">
        <img src="icons/icon-48.png" width="48" height="48" alt="" />
        <h1>{t('lock.title')}</h1>
        <p class="bp-lock-sub">{t('lock.subtitle')}</p>
        {load.status === 'loading' && <Spinner />}
        {load.status === 'failed' && <Banner tone="red">{t('lock.loadFailed')}</Banner>}
        {load.status === 'ready' && (
          <PasswordForm
            label={t('lock.password')}
            submitLabel={t('lock.unlock')}
            retryAt={load.retryAt}
            check={(password) => client.call('wallet.unlock', { password })}
            onSuccess={() => {
              navigate(homeTarget);
            }}
          />
        )}
        <button
          type="button"
          class="bp-lock-forgot"
          onClick={() => {
            navigate(importTarget);
          }}
        >
          {t('lock.forgot')}
        </button>
        <small class="bp-lock-warning">{t('lock.forgotWarning')}</small>
      </main>
    </Layout>
  );
}
