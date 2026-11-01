import type { NetworkId } from '@beepocket/core';
import type { Storage } from '../../platform';
import type { PreferredTokensStore, WalletAddresses } from './ports';

/**
 * Stand-ins used until the wallet service provides the profile: preferred tokens live in plain
 * storage and no addresses exist. The wallet story replaces both at the composition root.
 */
export class StoragePreferredTokens implements PreferredTokensStore {
  constructor(private readonly storage: Storage) {}

  async get(network: NetworkId): Promise<string[]> {
    const raw = await this.storage.get(`preferredTokens:${network}`);
    return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string') : [];
  }

  set(network: NetworkId, denoms: string[]): Promise<void> {
    return this.storage.set(`preferredTokens:${network}`, denoms);
  }
}

export const noAddresses: WalletAddresses = { list: () => Promise.resolve([]) };
