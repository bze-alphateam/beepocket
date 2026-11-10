import { shortAddress } from '@beepocket/core';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import {
  DappProtocolCodes,
  WalletErrorCodes,
  type ConnectedSiteView,
  type ResponseOf,
  type WalletAddress,
} from '../../protocol';
import {
  Avatar,
  Banner,
  BottomActions,
  Button,
  EmptyState,
  Icon,
  RadioList,
  Sheet,
  Spinner,
} from '../../ui';
import { SETTINGS_PARENT, SettingsPage } from '../settings/SettingsPage';
import { useSiteIcons } from './site-icons';

type Listing = ResponseOf<'sites.list'>;
type Outcome = { ok: true } | { ok: false; error: { code: string } };

/** The hostname, plus the port when it is not the default one; the scheme when it is not https. */
export function siteName(origin: string): string {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' ? url.host : `${url.protocol}//${url.host}`;
  } catch {
    return origin;
  }
}

/** `W-Sites-Change`: the address a site sees, one Save. Home's current-site strip opens it too. */
export function ChangeSheet(props: {
  site: ConnectedSiteView;
  addresses: WalletAddress[];
  busy: boolean;
  /** A failed save, shown in the sheet: the screen's banner would sit behind it. */
  error: string | null;
  onSave: (index: number) => void;
  onClose: () => void;
}) {
  const current = props.addresses.find((a) => a.address === props.site.address);
  const [index, setIndex] = useState(current?.index ?? props.addresses[0]?.index ?? 0);
  const name = siteName(props.site.origin);
  return (
    <Sheet
      open
      title={t('sites.change.title', { site: name })}
      onClose={props.onClose}
      actions={
        <Button
          disabled={props.busy}
          onClick={() => {
            props.onSave(index);
          }}
        >
          {t('sites.change.save')}
        </Button>
      }
    >
      {props.error !== null && (
        <div class="bp-sites-error">
          <Banner tone="red">{props.error}</Banner>
        </div>
      )}
      <RadioList
        label={t('sites.change.pick', { site: name })}
        value={index}
        disabled={props.busy}
        onChange={setIndex}
        options={props.addresses.map((a) => ({
          value: a.index,
          title: a.label,
          subtitle: shortAddress(a.address),
        }))}
      />
      <p class="bp-sites-note">{t('sites.change.note', { site: name })}</p>
    </Sheet>
  );
}

/**
 * One connected site in one line: its icon, the whole domain (wrapped, never cut), the address
 * it sees, then Change and Disconnect. The Connected sites list and Home's current-site strip.
 */
export function SiteRow(props: {
  site: ConnectedSiteView;
  busy: boolean;
  onChange: () => void;
  onDisconnect: () => void;
  /** Home's strip: the row on its own inset background. */
  strip?: boolean;
}) {
  const { site } = props;
  const icons = useSiteIcons();
  const name = siteName(site.origin);
  return (
    <div class={props.strip === true ? 'bp-site-row bp-site-row-strip' : 'bp-site-row'}>
      <Avatar
        label={name.replace(/^https?:\/\//, '')}
        kind="site"
        size={20}
        src={icons.url(site.origin)}
      />
      <span class="bp-site-row-text">
        <span class="bp-site-row-domain">{name}</span>
        <span class="bp-site-row-who">
          {site.label} · <span class="bp-mono">{shortAddress(site.address)}</span>
        </span>
      </span>
      <button
        type="button"
        class="bp-site-row-btn"
        aria-haspopup="dialog"
        aria-label={t('sites.change.label', { site: name, label: site.label })}
        disabled={props.busy}
        onClick={props.onChange}
      >
        <Icon name="swap" size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        class="bp-site-row-btn bp-site-row-x"
        aria-label={t('sites.disconnect.label', { site: name })}
        disabled={props.busy}
        onClick={props.onDisconnect}
      >
        <Icon name="unlink" size={16} strokeWidth={2} />
      </button>
    </div>
  );
}

/** Connected sites is a Settings page: ← goes to Configuration, × to Home. */
function SitesPage(props: { actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <SettingsPage
      title={t('sites.title')}
      backLabel={t('sites.back')}
      parent={SETTINGS_PARENT['dapp.sites']}
      actions={props.actions}
    >
      {props.children}
    </SettingsPage>
  );
}

/** Settings › Connected sites: the sites of the active network, with Change and Disconnect. */
export function ConnectedSitesScreen() {
  const client = useClient();
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

  /** Runs the calls one by one and stops at the first failure. */
  const run = async (calls: (() => Promise<Outcome>)[]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let r: Outcome = { ok: true };
    for (const call of calls) {
      r = await call();
      if (!r.ok) break;
    }
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
  const disconnect = (origin: string) => () => client.call('sites.disconnect', { origin });

  if (failed) {
    return (
      <SitesPage>
        <Banner tone="red">{t('sites.loadFailed')}</Banner>
      </SitesPage>
    );
  }
  if (listing === null) {
    return (
      <SitesPage>
        <Spinner />
      </SitesPage>
    );
  }

  const { sites } = listing;
  const testnet = listing.network === 'testnet';
  return (
    <SitesPage
      actions={
        sites.length > 1 ? (
          <BottomActions>
            <Button
              variant="secondary"
              class="bp-sites-all"
              disabled={busy}
              onClick={() => {
                void run(sites.map((s) => disconnect(s.origin)));
              }}
            >
              {t('sites.disconnectAll')}
            </Button>
          </BottomActions>
        ) : undefined
      }
    >
      <main class="bp-sites">
        {error !== null && changing === null && <Banner tone="red">{error}</Banner>}
        {sites.length === 0 ? (
          <EmptyState
            icon="link"
            title={t(testnet ? 'sites.empty.testnet' : 'sites.empty.mainnet')}
            sub={t('sites.empty.sub')}
          />
        ) : (
          <>
            <p class={testnet ? 'bp-sites-net bp-sites-net-testnet' : 'bp-sites-net'}>
              {t(testnet ? 'sites.net.testnet' : 'sites.net.mainnet', {
                count: String(sites.length),
              })}
            </p>
            <ul class="bp-sites-list">
              {sites.map((site) => (
                <li key={site.origin}>
                  <SiteRow
                    site={site}
                    busy={busy}
                    onChange={() => {
                      setChanging(site);
                    }}
                    onDisconnect={() => {
                      void run([disconnect(site.origin)]);
                    }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      {changing !== null && (
        <ChangeSheet
          site={changing}
          addresses={listing.addresses}
          busy={busy}
          error={error}
          onSave={(index) => {
            void run([() => client.call('sites.change', { origin: changing.origin, index })]);
          }}
          onClose={() => {
            setChanging(null);
            setError(null);
          }}
        />
      )}
    </SitesPage>
  );
}
