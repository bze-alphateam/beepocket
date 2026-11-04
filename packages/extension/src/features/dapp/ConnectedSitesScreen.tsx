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
  type WalletAddress,
} from '../../protocol';
import {
  Banner,
  BottomActions,
  Button,
  EmptyState,
  Icon,
  RadioList,
  ScreenHeader,
  Sheet,
  SiteCard,
  Spinner,
} from '../../ui';

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

/** One connected site (`W-Sites`): who it is, Disconnect, the address it sees and since when. */
function SiteItem(props: {
  site: ConnectedSiteView;
  busy: boolean;
  onChange: () => void;
  onDisconnect: () => void;
}) {
  const { site } = props;
  const name = siteName(site.origin);
  const since = new Date(site.connectedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  return (
    <li class="bp-sites-item">
      <SiteCard
        origin={site.origin}
        size="md"
        aside={
          <button
            type="button"
            class="bp-sites-disconnect"
            aria-label={t('sites.disconnect.label', { site: name })}
            disabled={props.busy}
            onClick={props.onDisconnect}
          >
            {t('sites.disconnect')}
          </button>
        }
      />
      <button
        type="button"
        class="bp-sites-sees"
        aria-haspopup="dialog"
        aria-label={t('sites.change.label', { site: name, label: site.label })}
        disabled={props.busy}
        onClick={props.onChange}
      >
        <span class="bp-sites-sees-caption">{t('sites.sees')}</span>
        <span class="bp-sites-sees-who">
          <span class="bp-sites-sees-label">{site.label}</span>
          <span class="bp-mono">{shortAddress(site.address)}</span>
        </span>
        <span class="bp-sites-sees-change">{t('sites.change')}</span>
        <Icon name="chevron-right" size={14} strokeWidth={2.2} />
      </button>
      <span class="bp-sites-since">{t('sites.since', { date: since })}</span>
    </li>
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

  const header = (
    <ScreenHeader
      title={t('sites.title')}
      backLabel={t('sites.back')}
      onBack={() => {
        navigate({ name: 'settings.main' });
      }}
      right={listing && <span class="bp-sites-count">{listing.sites.length}</span>}
    />
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

  const { sites } = listing;
  return (
    <Layout
      header={header}
      footer={
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
        <p class="bp-sites-sub">{t('sites.sub')}</p>
        {error !== null && changing === null && <Banner tone="red">{error}</Banner>}
        {sites.length === 0 ? (
          <EmptyState icon="link" title={t('sites.empty')} sub={t('sites.empty.sub')} />
        ) : (
          <ul class="bp-sites-list">
            {sites.map((site) => (
              <SiteItem
                key={site.origin}
                site={site}
                busy={busy}
                onChange={() => {
                  setChanging(site);
                }}
                onDisconnect={() => {
                  void run([disconnect(site.origin)]);
                }}
              />
            ))}
          </ul>
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
    </Layout>
  );
}
