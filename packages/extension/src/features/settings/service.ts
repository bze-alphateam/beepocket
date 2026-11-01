import { NETWORKS, type NetworkId } from '@beepocket/core';
import { ok, type Result, type WalletSettings } from '../../protocol';
import type { Storage } from '../../platform/ports';
import { DEFAULT_NETWORK, NETWORK_KEY } from '../../background/services';
import type { WalletService } from '../wallet';

/** The slice of the wallet service the settings need. */
export type SettingsWallet = Pick<WalletService, 'getProfile' | 'updateProfile' | 'rearm'>;

export interface SettingsDeps {
  wallet: SettingsWallet;
  /** The unencrypted store holding the `network` key. */
  storage: Pick<Storage, 'get' | 'set'>;
}

export function isNetworkId(x: unknown): x is NetworkId {
  return typeof x === 'string' && Object.hasOwn(NETWORKS, x);
}

export class SettingsService {
  constructor(private readonly deps: SettingsDeps) {}

  async get(): Promise<Result<WalletSettings>> {
    const profile = await this.deps.wallet.getProfile();
    return profile.ok ? ok({ ...profile.value.settings }) : profile;
  }

  /** The wallet validates the merged settings; an invalid combination comes back typed. */
  async set(patch: Partial<WalletSettings>): Promise<Result<WalletSettings>> {
    const updated = await this.deps.wallet.updateProfile((profile) => ({
      ...profile,
      settings: { ...profile.settings, ...patch },
    }));
    if (!updated.ok) return updated;
    await this.deps.wallet.rearm();
    return ok({ ...updated.value.settings });
  }

  async network(): Promise<{ id: NetworkId }> {
    const stored = await this.deps.storage.get(NETWORK_KEY);
    return { id: isNetworkId(stored) ? stored : DEFAULT_NETWORK };
  }

  async setNetwork(id: NetworkId): Promise<Result<{ id: NetworkId }>> {
    await this.deps.storage.set(NETWORK_KEY, id);
    return ok({ id });
  }
}
