import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import {
  DappProtocolCodes,
  WalletErrorCodes,
  type ConnectedSiteView,
  type WalletAddress,
} from '../../protocol';
import { Banner, Icon } from '../../ui';
import { ChangeSheet, siteName } from '../dapp/ConnectedSitesScreen';

type Outcome = { ok: true } | { ok: false; error: { code: string } };

function errorText(code: string): string {
  if (code === WalletErrorCodes.needsPassword) return t('sites.needsUnlock');
  if (code === DappProtocolCodes.unknownSite) return t('sites.gone');
  return t('sites.failed');
}

/**
 * The site in the tab the popup was opened over, when it is connected on the active network:
 * the address it sees, Change and Disconnect, the same calls as Settings › Connected sites.
 * Nothing at all for any other tab.
 */
export function CurrentSite() {
  const client = useClient();
  const [site, setSite] = useState<ConnectedSiteView | null>(null);
  const [addresses, setAddresses] = useState<WalletAddress[]>([]);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // A worker that cannot answer (its port went away) just means no strip.
    // An empty or malformed answer reads the same: nothing to show.
    const r = await client.call('sites.current', {}).catch(() => null);
    const answer: { site?: ConnectedSiteView | null; addresses?: WalletAddress[] } | undefined =
      r?.ok ? r.value : undefined;
    setSite(answer?.site ?? null);
    setAddresses(answer?.addresses ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (site === null) return null;
  const name = siteName(site.origin);

  const run = async (call: () => Promise<Outcome>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call().catch((): Outcome => ({ ok: false, error: { code: '' } }));
    setBusy(false);
    if (r.ok) setChanging(false);
    else {
      setError(errorText(r.error.code));
      if (r.error.code === DappProtocolCodes.unknownSite) setChanging(false);
    }
    await load();
  };

  return (
    <section class="bp-home-site" aria-label={t('sites.current.label')}>
      <div class="bp-home-site-row">
        <button
          type="button"
          class="bp-home-site-sees"
          aria-haspopup="dialog"
          aria-label={t('sites.change.label', { site: name, label: site.label })}
          disabled={busy}
          onClick={() => {
            setError(null);
            setChanging(true);
          }}
        >
          <span class="bp-home-site-name">{name}</span>
          <span aria-hidden="true">·</span>
          <span class="bp-home-site-label">{site.label}</span>
          <Icon name="chevron-down" size={12} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          class="bp-home-site-disconnect"
          aria-label={t('sites.disconnect.label', { site: name })}
          disabled={busy}
          onClick={() => {
            void run(() => client.call('sites.disconnect', { origin: site.origin }));
          }}
        >
          {t('sites.disconnect')}
        </button>
      </div>
      {error !== null && !changing && <Banner tone="red">{error}</Banner>}
      {changing && (
        <ChangeSheet
          site={site}
          addresses={addresses}
          busy={busy}
          error={error}
          onSave={(index) => {
            void run(() => client.call('sites.change', { origin: site.origin, index }));
          }}
          onClose={() => {
            setChanging(false);
            setError(null);
          }}
        />
      )}
    </section>
  );
}
