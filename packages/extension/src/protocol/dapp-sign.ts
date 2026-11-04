import type { NetworkId, TxSummary } from '@beepocket/core';
import type { FeeChoice } from './send';

/** The fee the user saw. The worker signs it only if it still prices the same. */
export interface ReviewedFee {
  denom: string;
  /** Base units, decimal string. */
  amount: string;
  gasLimit: string;
}

/** What the sign screen shows. Everything here comes from the very bytes that get signed. */
export interface SignDetails {
  /** The connected address that signs. */
  signer: { label: string; address: string };
  summary: TxSummary;
  /** The decoded messages as pretty JSON, for "Message details". */
  rawJson: string;
  /** The decoded JSON of each message, same order as `summary.messages`. */
  messageJson: string[];
  /** The weak lock: the screen asks the password before approving. */
  locked: boolean;
  /** The pre-selected fee, one of `options`. */
  fee: FeeChoice;
  /** Every token the signer can pay this fee with, native first. */
  options: FeeChoice[];
}

export type SignView = {
  status: 'sign';
  id: string;
  origin: string;
  network: NetworkId;
} & SignDetails;
