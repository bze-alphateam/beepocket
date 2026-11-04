import {
  feePricing,
  minimumFee,
  rawJson,
  simulatedGasFor,
  summarise,
  verifySignRequest,
  type AnyMsg,
  type FeeData,
  type FeeEstimate,
  type SimulatedGas,
  type TxSummary,
} from '@beepocket/core';
import {
  ErrorCodes,
  fail,
  ok,
  type FeeChoice,
  type Result,
  type SignDetails,
  type SiteFeeCheck,
} from '../../protocol';
import { validContact } from '../../features/address-book/contact';
import { pricingToWire } from '../../features/send/override';
import type { ProfileAddress } from '../../features/wallet/profile';
import { refuse, type Outcome, type PendingRequest } from '../types';
import { bigintFromWire, bytesFromWire, DappErrorCodes } from '../wire';
import { guarded, simulationMessage, type ChainEnv, type TxDeps } from './env';
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

/** The pretty JSON of one message. */
function messageJsonOf(msg: AnyMsg): string {
  const [only] = JSON.parse(rawJson([msg])) as unknown[];
  return JSON.stringify(only, null, 2);
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
  /** The JSON of each message on its own. */
  messageJson: string[];
  /**
   * The site's fee when it can be paid, then the fee tokens the signer can pay with, each with
   * the gas limit it pays for.
   */
  options: FeeChoice[];
  defaultFee: FeeChoice;
  /** What was made of the site's fee; null when the request carried none. */
  siteFee: SiteFeeCheck | null;
  locked: boolean;
  /** What the simulations used: the native kind and the other tokens' kind. */
  simulated: SimulatedGas;
  /** The fee prices right now, for pricing Advanced settings. */
  feeData: FeeData;
  /** The signer's balances right now. */
  balances: Map<string, bigint>;
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
    return info
      ? [
          {
            ...info,
            amount: o.amount.toString(),
            gasLimit: o.gasLimit.toString(),
            gasUsed: o.gasUsed.toString(),
          },
        ]
      : [];
  });
}

/** A fee token's display data with its pricing, so Advanced can price any gas limit. */
function withPricing(info: FeeChoice, data: FeeData): FeeChoice {
  const pricing = feePricing(data, info.denom);
  return pricing ? { ...info, pricing: pricingToWire(pricing) } : info;
}

/** The fee the site put in the auth info, as it came: null for none, an empty or a zero one. */
interface SiteFee {
  coins: { denom: string; amount: string }[];
  gasLimit: bigint;
}

const DIGITS = /^\d{1,78}$/;

function siteFeeOf(
  fee: { amount: { denom: string; amount: string }[]; gasLimit: bigint } | undefined,
): SiteFee | null {
  if (!fee || fee.amount.length === 0 || fee.gasLimit === 0n) return null;
  // A fee of nothing at all is the same as none: the wallet prices it as before.
  if (fee.amount.every((c) => DIGITS.test(c.amount) && BigInt(c.amount) === 0n)) return null;
  return { coins: fee.amount, gasLimit: fee.gasLimit };
}

/**
 * The gas a fee in the native token or another one is checked against: the simulation with a
 * fee in its kind, else the other one (a site's fee can be in a token whose simulation failed).
 * The estimator throws when neither passed.
 */
export function gasUsedFor(simulated: SimulatedGas, native: boolean): bigint {
  const gas = simulatedGasFor(simulated, native) ?? simulatedGasFor(simulated, !native);
  if (gas === null) throw new Error('no simulation passed');
  return gas;
}

/** Rounded half up. */
function roundedRatio(num: bigint, den: bigint): number {
  return Number((num * 2n + den) / (den * 2n));
}

/** At most this many times the wallet's own estimate before the site's fee is called high. */
const HIGH_FEE_TIMES = 3n;

/**
 * The site's fee as an option, with what the wallet makes of it; `null` option when it cannot
 * be paid. `walletAmount` is the wallet's own estimate in the same token, when it has one;
 * `simulated` is what the simulations of this transaction used: the site's gas limit is checked
 * against the one with a fee in its token's kind (the other one when that one failed).
 */
function checkSiteFee(
  fee: SiteFee,
  origin: string,
  data: FeeData,
  balances: Map<string, bigint>,
  info: FeeChoice | undefined,
  estimate: { walletAmount: bigint | undefined; simulated: SimulatedGas },
): { option: FeeChoice | null; check: SiteFeeCheck } {
  const unusable = { option: null, check: { status: 'unusable' as const } };
  const [coin] = fee.coins;
  if (fee.coins.length !== 1 || !coin || !DIGITS.test(coin.amount) || !info) return unusable;
  const amount = BigInt(coin.amount);
  const minimum = minimumFee(data, coin.denom, fee.gasLimit);
  if (minimum === null || (balances.get(coin.denom) ?? 0n) < amount) return unusable;
  const gasUsed = gasUsedFor(estimate.simulated, coin.denom === data.nativeDenom);
  const option: FeeChoice = {
    ...info,
    amount: amount.toString(),
    gasLimit: fee.gasLimit.toString(),
    gasUsed: gasUsed.toString(),
    setBy: origin,
  };
  // Too little gas runs out mid-way and the fee is still charged.
  if (fee.gasLimit < gasUsed) return { option, check: { status: 'gas' } };
  if (amount < minimum) return { option, check: { status: 'low' } };
  const { walletAmount } = estimate;
  if (walletAmount !== undefined && amount > walletAmount * HIGH_FEE_TIMES) {
    // A zero estimate (a zero gas price) makes any fee too high, by no meaningful ratio.
    const times = walletAmount === 0n ? null : roundedRatio(amount, walletAmount);
    return { option, check: { status: 'high', times } };
  }
  return { option, check: { status: 'ok' } };
}

/** The display data of a fee token, or undefined when it cannot be shown right. */
async function feeTokenInfo(env: ChainEnv, denom: string): Promise<FeeChoice | undefined> {
  const info = await env.tokens.resolve(denom).then(
    (t) => (t.source === 'fallback' ? null : t),
    () => null,
  );
  if (!info) return undefined;
  return {
    denom,
    amount: '0',
    gasLimit: '0',
    gasUsed: '0',
    symbol: info.symbol,
    decimals: info.decimals,
    logo: info.logo,
  };
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

  const siteFee = siteFeeOf(verified.authInfo.fee);
  const siteDenom = siteFee?.coins.length === 1 ? siteFee.coins[0]?.denom : undefined;
  const estimated = await guarded(
    () =>
      Promise.all([
        // The site's token, when it is another token, is the one its fee is simulated with.
        env.fees.estimate({
          bodyBytes,
          pubKey,
          sequence: account.sequence,
          balances,
          ...(siteDenom === undefined ? {} : { preferred: siteDenom }),
        }),
        env.fees.feeData(),
      ]),
    simulationMessage,
  );
  if (!estimated.ok) return { kind: 'refuse', outcome: estimated.outcome };
  const [estimate, feeData] = estimated.value;

  // A token whose display data cannot be read is left out: its fee could not be shown right.
  const infos = new Map<string, FeeChoice>();
  const denoms = new Set(estimate.options.map((o) => o.denom));
  if (siteDenom !== undefined) denoms.add(siteDenom);
  for (const denom of denoms) {
    const info = await feeTokenInfo(env, denom);
    const balance = (balances.get(denom) ?? 0n).toString();
    if (info) infos.set(denom, withPricing({ ...info, balance }, feeData));
  }
  const walletOptions = toChoices(estimate, infos);
  const walletDefault = walletOptions.find((o) => o.denom === estimate.default) ?? walletOptions[0];

  // The site's fee is signed as it came unless it cannot be paid; the wallet's own options
  // stay on the fee sheet either way.
  const site = siteFee
    ? checkSiteFee(
        siteFee,
        request.origin,
        feeData,
        balances,
        siteDenom === undefined ? undefined : infos.get(siteDenom),
        {
          walletAmount: estimate.options.find((o) => o.denom === siteDenom)?.amount,
          simulated: estimate.simulated,
        },
      )
    : null;
  const options = site?.option ? [site.option, ...walletOptions] : walletOptions;
  const defaultFee = site?.option ?? walletDefault;
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
      messageJson: verified.messages.map(messageJsonOf),
      options,
      defaultFee,
      siteFee: site?.check ?? null,
      locked: state !== 'unlocked',
      simulated: estimate.simulated,
      feeData,
      balances,
    },
  };
}

/** The screen's view of a prepared request. */
export function detailsOf(p: Prepared): SignDetails {
  return {
    signer: { label: p.entry.label, address: p.entry.address },
    summary: p.summary,
    rawJson: p.rawJson,
    messageJson: p.messageJson,
    locked: p.locked,
    fee: p.defaultFee,
    options: p.options,
    ...(p.siteFee ? { siteFee: p.siteFee } : {}),
  };
}
