import {
  TokenResolver,
  type Cache,
  type ChainClient,
  type NetworkId,
  type ScanClient,
} from '@beepocket/core';

/** BZE's logo, shipped with the extension: the round "BZ" mark the dapps use. */
export const BZE_LOGO = '/tokens/bze.png';

export interface TokenResolverDeps {
  chain: ChainClient;
  scan: ScanClient;
  cache: Cache;
}

/** The one way the extension builds a `TokenResolver`, so every screen resolves tokens alike. */
export function createTokenResolver(deps: TokenResolverDeps, network: NetworkId): TokenResolver {
  // Keys carry the network id so a network switch never reads the other network's data.
  return new TokenResolver(deps.chain, deps.scan, {
    cache: deps.cache,
    cacheKeyPrefix: `${network}:`,
    nativeLogo: BZE_LOGO,
  });
}
