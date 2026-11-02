import {
  rawJson,
  summarise,
  verifySignRequest,
  type FeeEstimate,
  type TxSummary,
} from '@beepocket/core';
import { ErrorCodes, fail, ok, type FeeChoice, type Result, type SignDetails } from '../../protocol';
import { validContact } from '../../features/address-book/contact';
import type { ProfileAddress } from '../../features/wallet/profile';
import { refuse, type Outcome, type PendingRequest } from '../types';
import { bigintFromWire, bytesFromWire, DappErrorCodes } from '../wire';
import { guarded, simulationMessage, type TxDeps } from './env';
import { connectedAddress, networkRefusal, pubKeyOf } from './key';

/** `signDirect` params as they are kept with the pending request (JSON: bytes are base64). */
export interface SignParams {
  chainId: string;
  signer: string;
  signDoc: {
    bodyBytes: string;
    authInfoBytes: string;
    chainId: string;
    accountNumber: string;
  };
}

const MAX_CHAIN_ID = 64;
/** Base64 of the verifier's 256 KiB body and 8 KiB auth info caps, so nothing huge is decoded. */
const MAX_BODY_TEXT = 350_000;
const MAX_AUTH_INFO_TEXT = 11_000;
const MAX_ADDRESS = 128;

function text(x: unknown, max: number): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= max;
}

function isBytes(x: unknown, max: number): x is string {
  if (!text(x, max)) return false;
  try {
    bytesFromWire(x);
    return true;
  } catch {
    return false;
  }
}

export function validateSignParams(params: unknown): Result<SignParams> {
  const bad = fail(ErrorCodes.badRequest, 'signDirect needs a chainId, a signer and a signDoc.');
  if (typeof params !== 'object' || params === null) return bad;
  const { chainId, signer, signDoc } = params as Record<string, unknown>;
  if (!text(chainId, MAX_CHAIN_ID) || !text(signer, MAX_ADDRESS)) return bad;
  if (typeof signDoc !== 'object' || signDoc === null) return bad;
  const doc = signDoc as Record<string, unknown>;
  if (
    !isBytes(doc.bodyBytes, MAX_BODY_TEXT) ||
    !isBytes(doc.authInfoBytes, MAX_AUTH_INFO_TEXT) ||
    !text(doc.chainId, MAX_CHAIN_ID) ||
    typeof doc.accountNumber !== 'string'
  ) {
    return bad;
  }
  try {
    bigintFromWire(doc.accountNumber);
  } catch {
    return bad;
  }
  return ok({
    chainId,
    signer,
    signDoc: {
      bodyBytes: doc.bodyBytes,
      authInfoBytes: doc.authInfoBytes,
      chainId: doc.chainId,
      accountNumber: doc.accountNumber,
    },
  });
}

/** What a request is, checked against the chain right now. */
export interface Prepared {
  entry: ProfileAddress;
  pubKey: Uint8Array;
  /** Exactly the request's bytes: what is summarised is what is signed. */
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
  summary: TxSummary;
  rawJson: string;
  gasLimit: bigint;
  /** The fee tokens the signer can pay with, priced for `gasLimit`. */
  options: FeeChoice[];
  defaultFee: FeeChoice;
  locked: boolean;
}

export type Preparation =
  | { kind: 'ready'; prepared: Prepared }
  | { kind: 'refuse'; outcome: Outcome }
  /** Fully locked: wait for the unlock screen. */
  | { kind: 'locked' }
  /** Weak lock and the public key is not known yet: the password comes first. */
  | { kind: 'unlock' };

const refused = (code: string, message: string): Preparation => ({
  kind: 'refuse',
  outcome: refuse(code, message),
});

function contactName(book: unknown[], address: string): string | null {
  for (const c of book) if (validContact(c) && c.address === address) return c.name;
  return null;
}

function toChoices(estimate: FeeEstimate, infos: Map<string, FeeChoice>): FeeChoice[] {
  return estimate.options.flatMap((o) => {
    const info = infos.get(o.denom);
    return info ? [{ ...info, amount: o.amount.toString() }] : [];
  });
}

/**
 * Everything a `signDirect` request must pass before the user sees it or the wallet signs it:
 * network, wallet state, the connected site and its address, the account on chain, the
 * verifier, a fee the signer can pay and the summary. The review and the signature both run
 * this, so what is shown and what is signed cannot drift apart.
 */
export async function prepareSign(
  deps: TxDeps,
  request: PendingRequest,
  params: SignParams,
): Promise<Preparation> {
  const active = await deps.services.activeNetwork();
  const wrong = networkRefusal(request, params, active.id);
  if (wrong) return { kind: 'refuse', outcome: wrong };
  const { state } = await deps.wallet.state();
  if (state === 'uninitialised') {
    return refused(DappErrorCodes.notConnected, 'BeePocket has no wallet yet.');
  }
  const profile = state === 'locked' ? null : await deps.wallet.getProfile();
  if (!profile?.ok) return { kind: 'locked' };
  const entry = connectedAddress(profile.value, request);
  if (!entry) return refused(DappErrorCodes.notConnected, 'This site is not connected.');
  const pubKeyText = await pubKeyOf(deps, entry, state === 'unlocked');
  if (pubKeyText === null) return { kind: 'unlock' };
  const pubKey = bytesFromWire(pubKeyText);

  const env = await deps.env();
  const bodyBytes = bytesFromWire(params.signDoc.bodyBytes);
  const authInfoBytes = bytesFromWire(params.signDoc.authInfoBytes);
  const accountNumber = bigintFromWire(params.signDoc.accountNumber);

  const read = await guarded(
    () => Promise.all([env.chain.account(entry.address), env.chain.balances(entry.address)]),
    () => null,
  );
  if (!read.ok) return { kind: 'refuse', outcome: read.outcome };
  const [account, balances] = read.value;
  if (account === null) {
    return refused(DappErrorCodes.invalidRequest, 'Fund this address first.');
  }

  const verified = verifySignRequest({
    network: env.network,
    signer: params.signer,
    connectedAddress: entry.address,
    connectedPubKey: pubKey,
    signDoc: { bodyBytes, authInfoBytes, chainId: params.signDoc.chainId, accountNumber },
    chainAccount: account,
  });
  if (!verified.ok) {
    const code =
      verified.code === 'wrong-chain'
        ? DappErrorCodes.wrongChain
        : verified.code === 'not-connected-signer'
          ? DappErrorCodes.notConnected
          : DappErrorCodes.invalidRequest;
    return refused(code, verified.message);
  }

  const estimated = await guarded(
    () =>
      env.fees.estimate({ bodyBytes, pubKey, sequence: account.sequence, balances }),
    simulationMessage,
  );
  if (!estimated.ok) return { kind: 'refuse', outcome: estimated.outcome };
  const estimate = estimated.value;

  // A token whose display data cannot be read is left out: its fee could not be shown right.
  const infos = new Map<string, FeeChoice>();
  for (const o of estimate.options) {
    const info = await env.tokens.resolve(o.denom).then(
      (t) => (t.source === 'fallback' ? null : t),
      () => null,
    );
    if (info) {
      infos.set(o.denom, { denom: o.denom, amount: '0', symbol: info.symbol, decimals: info.decimals });
    }
  }
  const options = toChoices(estimate, infos);
  const defaultFee = options.find((o) => o.denom === estimate.default) ?? options[0];
  if (!defaultFee) {
    return refused(DappErrorCodes.invalidRequest, "This address can't pay the network fee.");
  }

  const summary = await summarise(
    verified.messages,
    {
      tokens: env.tokens,
      markets: env.chain,
      orders: env.chain,
      addressBook: (address) => contactName(profile.value.addressBook, address),
    },
    { memo: verified.body.memo },
  );
  return {
    kind: 'ready',
    prepared: {
      entry,
      pubKey,
      bodyBytes,
      authInfoBytes,
      chainId: params.signDoc.chainId,
      accountNumber,
      summary,
      rawJson: rawJson(verified.messages),
      gasLimit: estimate.gasLimit,
      options,
      defaultFee,
      locked: state !== 'unlocked',
    },
  };
}

/** The screen's view of a prepared request. */
export function detailsOf(p: Prepared): SignDetails {
  return {
    signer: { label: p.entry.label, address: p.entry.address },
    summary: p.summary,
    rawJson: p.rawJson,
    approvable: p.summary.level === 'normal',
    locked: p.locked,
    fee: p.defaultFee,
    options: p.options,
    gasLimit: p.gasLimit.toString(),
  };
}
