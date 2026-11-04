import type { NetworkId } from '@beepocket/core';
import { ok, type Result } from '../../protocol';
import type { WalletService } from '../wallet';
import type { TokenSeams } from './handlers';
import type { WalletAddress } from './ports';

/** The wallet service surface the token seams need. */
export type TokenWallet = Pick<WalletService, 'addresses' | 'getProfile' | 'updateProfile'>;

/**
 * Preferred tokens live in the wallet's encrypted profile (`preferredTokens`, per network) and
 * the addresses are the profile's. A locked wallet has no addresses and no list; writing needs
 * the wallet unlocked and answers the wallet's own error otherwise (`needs-password` in weak lock).
 */
export function walletTokenSeams(wallet: TokenWallet): TokenSeams {
  return {
    preferred: {
      async get(network: NetworkId): Promise<string[]> {
        const profile = await wallet.getProfile();
        return profile.ok ? [...profile.value.preferredTokens[network]] : [];
      },
      async set(network: NetworkId, denoms: string[]): Promise<Result<null>> {
        const updated = await wallet.updateProfile((profile) => ({
          ...profile,
          preferredTokens: { ...profile.preferredTokens, [network]: [...denoms] },
        }));
        return updated.ok ? ok(null) : updated;
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
