/** Error codes of the `send.*` methods (`Result.error.code`). */
export const SendErrorCodes = {
  /** The recipient is not a BeeZee address. */
  invalidAddress: 'invalid-address',
  /** The amount is empty, zero, not a plain decimal or has more decimals than the token. */
  invalidAmount: 'invalid-amount',
  /** The amount is more than the address holds. */
  insufficientFunds: 'insufficient-funds',
  /** The amount leaves nothing for the network fee in the same token: use max. */
  amountLeavesNoFee: 'amount-leaves-no-fee',
  /** No eligible fee token is held in a sufficient amount. UI: "This address can't pay the network fee". */
  cannotPayFee: 'cannot-pay-fee',
  /** The address is not on chain yet, so it has no account number. UI: "Fund this address first". */
  fundFirst: 'fund-first',
  /** The token's display data could not be read, so its decimals are unknown. */
  tokenUnavailable: 'token-unavailable',
  unknownAddress: 'unknown_address',
  /** The node would reject the transaction; the message is the node's own. */
  simulationFailed: 'simulation-failed',
  /** The fee or the amount is no longer what was reviewed; review again. */
  reviewChanged: 'review-changed',
  /** The node rejected the broadcast; the message is the node's own, verbatim. */
  rejected: 'tx-rejected',
  /** The node could not be reached or answered something unusable. */
  network: 'network-error',
  /** The address's on-chain key is not the wallet's key for it: nothing is signed. */
  keyMismatch: 'key-mismatch',
} as const;

export interface SendDraft {
  /** The wallet address index to send from. */
  fromIndex: number;
  to: string;
  denom: string;
}

export interface FeeChoice {
  denom: string;
  /** Base units of `denom`, decimal string. */
  amount: string;
  symbol: string;
  decimals: number;
  /** The fee token's logo URL (see `TokenInfo.logo`). */
  logo?: string | null;
  /** Base units of `denom` the paying address holds; set on send quotes (the fee sheet shows it). */
  balance?: string;
}

/** What the review screen shows. Everything here is exactly what `send.submit` signs. */
export interface SendQuote {
  from: { index: number; address: string };
  to: string;
  token: { denom: string; symbol: string; decimals: number };
  /** Base units, decimal string. */
  amount: string;
  /** Base units the address holds of the token. */
  balance: string;
  gasLimit: string;
  fee: FeeChoice;
  /** Every token the address can pay this send's fee with, native first. Includes `fee`. */
  options: FeeChoice[];
}

export interface SendPrepareRequest extends SendDraft {
  /** What the user typed, in display units; ignored with `max`. */
  amount: string;
  /** Send the whole balance (less the fee when the fee is paid in the same token). */
  max?: boolean;
  /** A fee token picked on the fee sheet; the default rule applies when absent. */
  feeDenom?: string;
}

/** The reviewed quote, handed back to sign. The amounts are base units. */
export interface SendSubmitRequest extends SendDraft {
  amount: string;
  feeDenom: string;
  feeAmount: string;
  gasLimit: string;
}

export type TxStatus =
  | { status: 'confirmed'; height: string; gasUsed: string }
  /** Included in a block but failed; `message` is the node's raw log. */
  | { status: 'failed'; message: string }
  /** Not seen within 60 s; `explorerUrl` opens it on Scan. */
  | { status: 'pending' };

/** Send methods. Bigints cross the boundary as decimal strings. */
export interface SendProtocol {
  'send.prepare': { req: SendPrepareRequest; res: SendQuote };
  /**
   * Re-simulates, signs and broadcasts exactly the reviewed quote. `unconfirmed` means the
   * broadcast got no usable answer: the transaction may still land, so the hash is polled.
   */
  'send.submit': { req: SendSubmitRequest; res: { txHash: string; unconfirmed?: true } };
  /** Waits for inclusion for up to 60 s. */
  'send.status': { req: { txHash: string }; res: TxStatus & { explorerUrl: string } };
}
