import {
  DappProtocolCodes,
  fail,
  ok,
  WalletErrorCodes,
  type ConnectedSiteView,
  type Result,
  type WalletAddress,
} from '../protocol';
import type { Services } from '../background/services';
import type { WalletService } from '../features/wallet';
import type { AccountChanges } from './account-changes';

/** The slice of `chrome.tabs` that finds the tab the user opened the popup over. */
export interface ActiveTabsLike {
  query(info: { active: true; lastFocusedWindow: true }): Promise<{ url?: string | undefined }[]>;
}

export interface SitesDeps {
  wallet: Pick<WalletService, 'getProfile' | 'updateProfile'>;
  services: Pick<Services, 'activeNetwork'>;
  changes: Pick<AccountChanges, 'notify'>;
  tabs: ActiveTabsLike;
}

/** The web origin of a tab's URL; null for anything but http(s) or a URL we may not read. */
function webOrigin(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Settings › Connected sites: what the user sees and does to the connections made through `connect`.
 * A site sees one address; Change and Disconnect take effect on its next call, and its open
 * pages are told to ask again. Both need the profile re-sealed, so a weak lock answers
 * `needs-password` like the other settings.
 */
export class SitesService {
  constructor(private readonly deps: SitesDeps) {}

  async list(): Promise<
    Result<{
      network: 'mainnet' | 'testnet';
      sites: ConnectedSiteView[];
      addresses: WalletAddress[];
    }>
  > {
    const network = (await this.deps.services.activeNetwork()).id;
    const profile = await this.deps.wallet.getProfile();
    if (!profile.ok) return profile;
    const addresses: WalletAddress[] = profile.value.addresses.map((a) => ({
      index: a.index,
      label: a.label,
      address: a.address,
    }));
    const sites = Object.entries(profile.value.sites[network])
      .flatMap(([origin, site]) => {
        const entry = addresses.find((a) => a.address === site.address);
        return entry
          ? [{ origin, label: entry.label, address: entry.address, connectedAt: site.connectedAt }]
          : [];
      })
      .sort((a, b) => b.connectedAt - a.connectedAt);
    return ok({ network, sites, addresses });
  }

  /**
   * The site in the tab the popup was opened over, when it is connected on the active network.
   * The URL comes from the browser (readable thanks to `activeTab`), never from the page; without
   * it, or on a non-web tab, there is no site.
   */
  async current(): Promise<Result<{ site: ConnectedSiteView | null; addresses: WalletAddress[] }>> {
    let origin: string | null = null;
    try {
      const [tab] = await this.deps.tabs.query({ active: true, lastFocusedWindow: true });
      origin = webOrigin(tab?.url);
    } catch {
      // no tab to look at
    }
    const listed = await this.list();
    if (!listed.ok) return listed;
    const site =
      origin === null ? null : (listed.value.sites.find((s) => s.origin === origin) ?? null);
    return ok({ site, addresses: listed.value.addresses });
  }

  async change(origin: string, index: number): Promise<Result<Record<string, never>>> {
    const network = (await this.deps.services.activeNetwork()).id;
    const outcome = { missing: false, unknownAddress: false };
    const saved = await this.deps.wallet.updateProfile((profile) => {
      const sites = profile.sites[network];
      const current = Object.hasOwn(sites, origin) ? sites[origin] : undefined;
      const entry = profile.addresses.find((a) => a.index === index);
      if (!current) outcome.missing = true;
      else if (!entry) outcome.unknownAddress = true;
      else sites[origin] = { ...current, address: entry.address };
      return profile;
    });
    if (!saved.ok) return saved;
    if (outcome.missing) return fail(DappProtocolCodes.unknownSite, 'This site is not connected.');
    if (outcome.unknownAddress) return fail(WalletErrorCodes.unknownAddress, 'No such address.');
    await this.deps.changes.notify({ origin, network });
    return ok({});
  }

  async disconnect(origin: string): Promise<Result<Record<string, never>>> {
    const network = (await this.deps.services.activeNetwork()).id;
    const outcome = { missing: false };
    const saved = await this.deps.wallet.updateProfile((profile) => {
      if (Object.hasOwn(profile.sites[network], origin)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete profile.sites[network][origin];
      } else outcome.missing = true;
      return profile;
    });
    if (!saved.ok) return saved;
    if (outcome.missing) return fail(DappProtocolCodes.unknownSite, 'This site is not connected.');
    await this.deps.changes.notify({ origin, network });
    return ok({});
  }
}
