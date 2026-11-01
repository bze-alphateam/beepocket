import type { NetworkId } from '@beepocket/core';
import type { WalletService } from '../wallet';
import type { TokenSeams } from './handlers';
import type { WalletAddress } from './ports';

/** The wallet service surface the token seams need. */
export type TokenWallet = Pick<WalletService, 'addresses' | 'getProfile' | 'updateProfile'>;

/**
 * Preferred tokens live in the wallet's encrypted profile (`preferredTokens`, per network) and
 * the addresses are the profile's. A locked wallet has no addresses and no list; writing needs
 * the wallet unlocked and throws otherwise (the popup reports it as a failed request).
 */
export function walletTokenSeams(wallet: TokenWallet): TokenSeams {
  return {
    preferred: {
      async get(network: NetworkId): Promise<string[]> {
        const profile = await wallet.getProfile();
        return profile.ok ? [...profile.value.preferredTokens[network]] : [];
      },
      async set(network: NetworkId, denoms: string[]): Promise<void> {
        const updated = await wallet.updateProfile((profile) => ({
          ...profile,
          preferredTokens: { ...profile.preferredTokens, [network]: [...denoms] },
        }));
        if (!updated.ok) throw new Error(updated.error.code);
      },
    },
    addresses: {
      async list(): Promise<WalletAddress[]> {
        const result = await wallet.addresses();
        return result.ok
          ? result.value.addresses.map((a) => ({ index: a.index, address: a.address }))
          : [];
      },
    },
  };
}
