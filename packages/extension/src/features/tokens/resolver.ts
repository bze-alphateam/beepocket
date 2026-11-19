import {
  BUNDLED_VERIFIED,
  TokenResolver,
  VerifiedRegistry,
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

/**
 * The verified tokens of BZE Scan for one network, cached; the look-alike check compares symbols
 * against them. Activity uses it on its own, the resolver through `createTokenResolver`.
 */
export function createVerifiedRegistry(
  deps: Pick<TokenResolverDeps, 'scan'> & { cache?: Cache | undefined },
  network: NetworkId,
): VerifiedRegistry {
  return new VerifiedRegistry(deps.scan, {
    ...(deps.cache ? { cache: deps.cache } : {}),
    cacheKeyPrefix: `${network}:`,
    // An unknown network id (a test double) has no bundled list.
    bundled:
      (BUNDLED_VERIFIED as Partial<Record<string, typeof BUNDLED_VERIFIED.mainnet>>)[network] ?? [],
  });
}

/** The one way the extension builds a `TokenResolver`, so every screen resolves tokens alike. */
export function createTokenResolver(deps: TokenResolverDeps, network: NetworkId): TokenResolver {
  // Keys carry the network id so a network switch never reads the other network's data.
  return new TokenResolver(deps.chain, deps.scan, {
    cache: deps.cache,
    cacheKeyPrefix: `${network}:`,
    nativeLogo: BZE_LOGO,
    verified: createVerifiedRegistry(deps, network),
  });
}
