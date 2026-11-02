import { shortAddress } from '@beepocket/core';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Layout } from '../../popup/Layout';
import { useClient } from '../../popup/client-context';
import { useRoute, type RouteBase } from '../../popup/router';
import {
  DappProtocolCodes,
  WalletErrorCodes,
  type ConnectedSiteView,
  type ResponseOf,
} from '../../protocol';
import { Banner, Button, Sheet, Spinner } from '../../ui';

type Listing = ResponseOf<'sites.list'>;

/** The hostname, plus the port when it is not the default one. */
export function siteName(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function networkName(id: Listing['network']): string {
  return id === 'mainnet' ? t('settings.network.mainnet') : t('settings.network.testnet');
}

function ChangeSheet(props: {
  site: ConnectedSiteView;
  addresses: Listing['addresses'];
  busy: boolean;
  onSave: (index: number) => void;
  onClose: () => void;
}) {
  const current = props.addresses.find((a) => a.address === props.site.address);
  const [index, setIndex] = useState(current?.index ?? props.addresses[0]?.index ?? 0);
  return (
    <Sheet
      open
      title={t('sites.change.title', { site: siteName(props.site.origin) })}
      onClose={props.onClose}
    >
      <fieldset class="bp-dapp-picker">
        {props.addresses.map((a) => (
          <label key={a.index} class="bp-dapp-option">
            <input
              type="radio"
              name="site-address"
              checked={a.index === index}
              disabled={props.busy}
              onChange={() => {
                setIndex(a.index);
              }}
            />
            <span class="bp-dapp-label">{a.label}</span>
            <span class="bp-dapp-short">{shortAddress(a.address)}</span>
          </label>
        ))}
      </fieldset>
      <div class="bp-dapp-actions">
        <Button variant="quiet" disabled={props.busy} onClick={props.onClose}>
          {t('sites.change.cancel')}
        </Button>
        <Button
          disabled={props.busy}
          onClick={() => {
            props.onSave(index);
          }}
        >
          {t('sites.change.save')}
        </Button>
      </div>
    </Sheet>
  );
}

/** Settings › Connected sites: the sites of the active network, with Change and Disconnect. */
export function ConnectedSitesScreen() {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const [listing, setListing] = useState<Listing | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState<ConnectedSiteView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await client.call('sites.list', {});
    if (r.ok) setListing(r.value);
    else setFailed(true);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    call: () => Promise<{ ok: true } | { ok: false; error: { code: string } }>,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (r.ok) {
      setChanging(null);
    } else if (r.error.code === WalletErrorCodes.needsPassword) {
      setError(t('sites.needsUnlock'));
    } else if (r.error.code === DappProtocolCodes.unknownSite) {
      setError(t('sites.gone'));
      setChanging(null);
    } else {
      setError(t('sites.failed'));
    }
    await load();
  };

  const header = (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          navigate({ name: 'settings.main' });
        }}
      >
        {t('sites.back')}
      </Button>
      <strong>{t('sites.title')}</strong>
    </>
  );

  if (failed) {
    return (
      <Layout header={header}>
        <Banner tone="red">{t('sites.loadFailed')}</Banner>
      </Layout>
    );
  }
  if (listing === null) {
    return (
      <Layout header={header}>
        <Spinner />
      </Layout>
    );
  }

  return (
    <Layout header={header}>
      <main class="bp-sites">
        {error !== null && <Banner tone="red">{error}</Banner>}
        {listing.sites.length === 0 && (
          <p class="bp-sites-empty">
            {t('sites.empty', { network: networkName(listing.network) })}
          </p>
        )}
        <ul class="bp-sites-list">
          {listing.sites.map((site) => (
            <li key={site.origin} class="bp-sites-item">
              <strong class="bp-sites-origin">{siteName(site.origin)}</strong>
              <small>
                {t('sites.sees', { label: site.label, address: shortAddress(site.address) })}
              </small>
              <small>
                {t('sites.since', { date: new Date(site.connectedAt).toLocaleDateString() })}
              </small>
              <div class="bp-sites-actions">
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setChanging(site);
                  }}
                >
                  {t('sites.change')}
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    void run(() => client.call('sites.disconnect', { origin: site.origin }));
                  }}
                >
                  {t('sites.disconnect')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </main>
      {changing !== null && (
        <ChangeSheet
          site={changing}
          addresses={listing.addresses}
          busy={busy}
          onSave={(index) => {
            void run(() => client.call('sites.change', { origin: changing.origin, index }));
          }}
          onClose={() => {
            setChanging(null);
          }}
        />
      )}
    </Layout>
  );
}
