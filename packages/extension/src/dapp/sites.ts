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

export interface SitesDeps {
  wallet: Pick<WalletService, 'getProfile' | 'updateProfile'>;
  services: Pick<Services, 'activeNetwork'>;
  changes: Pick<AccountChanges, 'notify'>;
}

/**
 * Settings › Connected sites: what the user sees and does to the connections made by BUS-75.
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

  async change(origin: string, index: number): Promise<Result<Record<string, never>>> {
    const network = (await this.deps.services.activeNetwork()).id;
    let missing = false;
    let unknownAddress = false;
    const saved = await this.deps.wallet.updateProfile((profile) => {
      const sites = profile.sites[network];
      const current = Object.hasOwn(sites, origin) ? sites[origin] : undefined;
      const entry = profile.addresses.find((a) => a.index === index);
      if (!current) missing = true;
      else if (!entry) unknownAddress = true;
      else sites[origin] = { ...current, address: entry.address };
      return profile;
    });
    if (!saved.ok) return saved;
    if (missing) return fail(DappProtocolCodes.unknownSite, 'This site is not connected.');
    if (unknownAddress) return fail(WalletErrorCodes.unknownAddress, 'No such address.');
    await this.deps.changes.notify({ origin, network });
    return ok({});
  }

  async disconnect(origin: string): Promise<Result<Record<string, never>>> {
    const network = (await this.deps.services.activeNetwork()).id;
    let missing = false;
    const saved = await this.deps.wallet.updateProfile((profile) => {
      if (Object.hasOwn(profile.sites[network], origin)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete profile.sites[network][origin];
      } else missing = true;
      return profile;
    });
    if (!saved.ok) return saved;
    if (missing) return fail(DappProtocolCodes.unknownSite, 'This site is not connected.');
    await this.deps.changes.notify({ origin, network });
    return ok({});
  }
}
