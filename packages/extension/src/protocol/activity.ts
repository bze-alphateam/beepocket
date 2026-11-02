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
  /** The other party's full address, for the wallet's own names (contacts, its addresses). */
  counterpartyAddress: string | null;
  /** Every non-zero change of this address in the transaction, largest absolute value first; minus the fee on a fee-only row. */
  amounts: ActivityAmount[];
  /** The row's only effect is a fee paid by this address. */
  feeOnly: boolean;
}

/** One signed change of one token. `amount` is base units, as a string. */
export interface ActivityAmount {
  denom: string;
  amount: string;
  /** Scan's display data for the denom; null when it knows none. */
  symbol: string | null;
  exponent: number | null;
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
  /** The wallet's whole activity merged across its addresses (or one address), 10 rows a call. */
  'activity.page': {
    req: { addressIndex?: number; cursor?: string };
    res: ActivityPageResult;
  };
}
