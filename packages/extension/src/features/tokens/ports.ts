import type { NetworkId } from '@beepocket/core';
import type { Result } from '../../protocol';

/** The user's preferred tokens, per network. Implemented over the wallet profile. */
export interface PreferredTokensStore {
  get(network: NetworkId): Promise<string[]>;
  /**
   * Refused writes come back as the store's error: `needs-password` in weak lock (the popup asks
   * the password and retries), `wallet_locked` when locked.
   */
  set(network: NetworkId, denoms: string[]): Promise<Result<null>>;
}

export interface WalletAddress {
  index: number;
  address: string;
}

/** The addresses of the wallet, in derivation order. Empty before a wallet exists. */
export interface WalletAddresses {
  list(network: NetworkId): Promise<WalletAddress[]>;
}
