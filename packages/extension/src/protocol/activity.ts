/** Error codes of the activity method (`Result.error.code`). */
export const ActivityErrorCodes = {
  /** Scan did not answer. The cursor of the failed call is still good: retry with it. */
  unavailable: 'activity-unavailable',
  /** The cursor is not one this method handed out. */
  badCursor: 'bad-cursor',
  /** `addressIndex` is not an address of the wallet. */
  unknownAddress: 'unknown-address',
} as const;

/** One row of the feed: one address's view of one transaction. Amounts are base units, as strings. */
export interface ActivityItem {
  addressIndex: number;
  addressLabel: string;
  /** RFC 3339. */
  time: string;
  txHash: string | null;
  kind: string;
  category: string;
  isSigner: boolean;
  success: boolean;
  /** Label, else moniker, else the short address; null when Scan names no single other party. */
  counterparty: string | null;
  /** Signed change of the token on this address, or minus the fee on a fee-only row; null if neither. */
  amount: string | null;
  /** The row's only effect on the token is a fee paid in it. */
  feeOnly: boolean;
}

export interface ActivityPageResult {
  /** Newest first, at most 10. */
  items: ActivityItem[];
  /** Opaque; pass it back for the next page. Null once `done`. */
  cursor: string | null;
  /** Every address is exhausted or past the 30-day cutoff. */
  done: boolean;
  /** The account page on the explorer: the selected address, else the first. */
  explorer: string;
}

export interface ActivityProtocol {
  /** One token's activity merged across the wallet's addresses (or one address), 10 rows a call. */
  'activity.page': {
    req: { denom: string; addressIndex?: number; cursor?: string };
    res: ActivityPageResult;
  };
}
