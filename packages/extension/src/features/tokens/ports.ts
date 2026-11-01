import type { NetworkId } from '@beepocket/core';

/** The user's preferred tokens, per network. Implemented over the wallet profile. */
export interface PreferredTokensStore {
  get(network: NetworkId): Promise<string[]>;
  set(network: NetworkId, denoms: string[]): Promise<void>;
}

export interface WalletAddress {
  index: number;
  address: string;
}

/** The addresses of the wallet, in derivation order. Empty before a wallet exists. */
export interface WalletAddresses {
  list(network: NetworkId): Promise<WalletAddress[]>;
}
