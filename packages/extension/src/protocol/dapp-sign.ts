import type { NetworkId, TxSummary } from '@beepocket/core';
import type { FeeChoice, FeeOverride } from './send';

/** The fee the user saw. The worker signs it only if it still prices the same. */
export interface ReviewedFee {
  denom: string;
  /** Base units, decimal string. */
  amount: string;
  gasLimit: string;
  /**
   * Set when the user changed the gas limit or price in Advanced: the worker prices this again
   * on a fresh simulation instead of matching one of the options.
   */
  override?: FeeOverride;
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
  /** The pre-selected fee, one of `options`: the site's own fee when it set a usable one. */
  fee: FeeChoice;
  /**
   * The site's fee (marked with `setBy`) when it set one that can be paid, then every token the
   * wallet can pay this fee with, native first.
   */
  options: FeeChoice[];
  /** What the wallet makes of the fee the site set; absent when the site set none. */
  siteFee?: SiteFeeCheck;
  /** What the simulation used, decimal string: Advanced's bounds start from it. */
  gasUsed: string;
}

/**
 * The site's fee, checked: `unusable` when its token cannot pay fees on BZE, the address holds
 * too little of it or it is in more than one token (the wallet's own fee is pre-selected
 * instead); `gas` when its gas limit is below what the simulation used; `low` when the chain
 * would refuse it for its gas limit; `high` when it is more than three times the wallet's own
 * estimate (`times` rounded, null when the wallet's estimate is zero); `ok` otherwise. Only the
 * first problem in that order is reported.
 */
export type SiteFeeCheck =
  | { status: 'ok' }
  | { status: 'unusable' }
  | { status: 'gas' }
  | { status: 'low' }
  | { status: 'high'; times: number | null };

export type SignView = {
  status: 'sign';
  id: string;
  origin: string;
  network: NetworkId;
} & SignDetails;
