import type { DenomBranding, TokenInfo } from '@beepocket/core';

/** Error codes of the token methods (`Result.error.code`). */
export const TokenErrorCodes = {
  /** The code is not a denom a chain could hold. */
  invalidCode: 'invalid-code',
  /** Zero supply on chain. UI text: "No token with this code on BeeZee". */
  noSuchToken: 'no-such-token',
  /** `tokens.remove` on the only preferred token. */
  lastToken: 'last-token',
} as const;

export interface AddressBalance {
  index: number;
  address: string;
  /** Base units, decimal string. */
  amount: string;
}

export interface TokenBalances {
  denom: string;
  addresses: AddressBalance[];
  /** Base units, decimal string. */
  total: string;
}

/** Token methods. Bigints cross the boundary as decimal strings. */
export interface TokensProtocol {
  /** A code is a base denom. */
  'tokens.lookup': { req: { code: string }; res: TokenInfo };
  /** The user's picks for the active network, in order. */
  'tokens.preferred': { req: Record<string, never>; res: TokenInfo[] };
  /** Appends at the end; adding a present token changes nothing. Answers the new list. */
  'tokens.add': { req: { denom: string }; res: TokenInfo[] };
  /** Refuses to remove the last token. Answers the new list. */
  'tokens.remove': { req: { denom: string }; res: TokenInfo[] };
  /** Over ubze and every denom held on any address; the only method that may return unpicked tokens. */
  'tokens.search': { req: { query: string }; res: TokenInfo[] };
  /** Read-through with a 10 s freshness; `refresh` skips it. */
  'tokens.balances': { req: { denom: string; refresh?: boolean }; res: TokenBalances };
  /** On-chain brand kit for the theme engine; `null` for none and for ubze (its own rule). */
  'tokens.theme': { req: { denom: string }; res: DenomBranding | null };
}
