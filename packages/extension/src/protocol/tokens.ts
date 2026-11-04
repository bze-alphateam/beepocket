import type { DenomBranding, TokenInfo } from '@beepocket/core';

/** Error codes of the token methods (`Result.error.code`). */
export const TokenErrorCodes = {
  /** The code is not a denom a chain could hold. */
  invalidCode: 'invalid-code',
  /** Zero supply on chain. UI text: "No token with this denom on BeeZee". */
  noSuchToken: 'no-such-token',
  /** `tokens.remove` on the only preferred token. */
  lastToken: 'last-token',
} as const;

/** A token as listed. `unresolved` marks a placeholder made from the denom alone (node unreachable). */
export type ListedToken = TokenInfo & { unresolved?: boolean };

export interface AddressBalance {
  index: number;
  address: string;
  /** Base units, decimal string; '0' with `failed`. */
  amount: string;
  /** The address could not be read this time. */
  failed?: boolean;
}

export interface TokenBalances {
  denom: string;
  addresses: AddressBalance[];
  /** Base units, decimal string. */
  /** Sum of the addresses that could be read. */
  total: string;
  /** True when some address failed: the total is incomplete. */
  partial: boolean;
}

export interface TokenSearch {
  tokens: ListedToken[];
  /** True when some address could not be read: tokens held only there are missing. */
  partial: boolean;
}

/** Token methods. Bigints cross the boundary as decimal strings. */
export interface TokensProtocol {
  /** A code is a base denom. */
  'tokens.lookup': { req: { code: string }; res: TokenInfo };
  /** The user's picks for the active network, in order. */
  'tokens.preferred': { req: Record<string, never>; res: ListedToken[] };
  /**
   * Appends at the end; adding a present token changes nothing. Answers the new list. The list is
   * in the encrypted profile: `needs-password` in weak lock, `wallet_locked` when locked.
   */
  'tokens.add': { req: { denom: string }; res: ListedToken[] };
  /** Refuses to remove the last token. Answers the new list. Lock errors as `tokens.add`. */
  'tokens.remove': { req: { denom: string }; res: ListedToken[] };
  /** Over ubze and every denom held on any address; the only method that may return unpicked tokens. */
  'tokens.search': { req: { query: string }; res: TokenSearch };
  /** Read-through with a 3 s freshness; `refresh` skips it. */
  'tokens.balances': { req: { denom: string; refresh?: boolean }; res: TokenBalances };
  /** The last read balances however old, never asking the node; `null` until every address was read once. */
  'tokens.lastBalances': { req: { denom: string }; res: TokenBalances | null };
  /** On-chain brand kit for the theme engine; `null` for none and for ubze (its own rule). */
  'tokens.theme': { req: { denom: string }; res: DenomBranding | null };
}
