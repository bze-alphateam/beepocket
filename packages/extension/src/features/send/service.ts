import {
  BroadcastError,
  HttpStatusError,
  NATIVE_DENOM,
  SimulationError,
  TransportError,
  TxTimeoutError,
  UnexpectedResponseError,
  balancesMayBeCut,
  buildAuthInfo,
  buildBody,
  encodeMsgSend,
  feePricing,
  isBzeAddress,
  parseAmount,
  priceGasOverride,
  signDocBytes,
  txHash,
  txRawBytes,
  withBalancesOf,
  type ChainClient,
  type Clock,
  type FeeData,
  type FeeEstimate,
  type FeeEstimator,
  type Network,
  type TokenInfo,
} from '@beepocket/core';
import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import { SendErrorCodes } from '../../protocol/send';
import type {
  FeeChoice,
  FeeOverride,
  SendPrepareRequest,
  SendQuote,
  SendSubmitRequest,
  TxStatus,
} from '../../protocol/send';
import { WalletErrorCodes, type WalletAddress, type WalletState } from '../../protocol/wallet';
import { multiplierOf, pricingToWire } from './override';
import { TIMEOUT_BLOCKS, type PendingSend, type PendingSends } from './pending';

/** The slice of the wallet service the send flow signs through. */
export interface SendWallet {
  state(): Promise<{ state: WalletState }>;
  addresses(): Promise<Result<{ addresses: WalletAddress[] }>>;
  /** Only while unlocked. */
  pubKey(address: string): Promise<Result<Uint8Array>>;
  signDirect(address: string, signDoc: Uint8Array): Promise<Result<Uint8Array>>;
  /** Restarts both lock timers. */
  rearm(): Promise<void>;
}

export interface SendDeps {
  /** The network this service signs for: the active one when the request came in. */
  network: Pick<Network, 'id' | 'chainId' | 'scan'>;
  chain: Pick<
    ChainClient,
    'account' | 'balances' | 'balance' | 'broadcast' | 'waitForTx' | 'latestHeight'
  >;
  fees: Pick<FeeEstimator, 'estimate' | 'feeData'>;
  tokens: { resolve(denom: string): Promise<TokenInfo> };
  wallet: SendWallet;
  clock: Clock;
  /** The last send each address signed on this network. */
  pending: PendingSends;
}

/** Waiting for inclusion: poll every second for up to a minute (Technical Design §7). */
export const STATUS_INTERVAL_MS = 1000;
export const STATUS_TIMEOUT_MS = 60_000;

/** The simulation does not verify signatures, so an address that never sent can use this key. */
const SIMULATION_PUBKEY = Uint8Array.from([2, ...new Array<number>(32).fill(1)]);
/** Passes to settle the fee of a max send paid in the sent token (the amount feeds the gas). */
const MAX_PASSES = 5;
const TX_HASH = /^[0-9A-Fa-f]{64}$/;
/** `ErrTxInMempoolCache`: the node already has these very bytes. */
const ALREADY_SENT = { codespace: 'sdk', code: 19 };
const BASE_UNITS = /^\d{1,60}$/;
const CANNOT_PAY = "This address can't pay the network fee.";
const LEAVES_NO_FEE = {
  code: SendErrorCodes.amountLeavesNoFee,
  message: 'Leave room for the network fee, or use max.',
};

interface Context {
  from: WalletAddress;
  sequence: bigint;
  accountNumber: bigint;
  accountPubKey: Uint8Array | null;
  balances: Map<string, bigint>;
  /** The latest block height the node reported. */
  height: bigint;
}

function nodeProblem(e: unknown): Result<never> | null {
  if (e instanceof SimulationError) return fail(SendErrorCodes.simulationFailed, e.message);
  if (e instanceof BroadcastError) {
    return fail(SendErrorCodes.rejected, e.rawLog === '' ? e.message : e.rawLog);
  }
  if (
    e instanceof TransportError ||
    e instanceof HttpStatusError ||
    e instanceof UnexpectedResponseError
  ) {
    return fail(SendErrorCodes.network, 'The network did not answer. Try again in a moment.');
  }
  return null;
}

/** Runs a node call; node failures become typed errors, anything else is a bug and propagates. */
async function guarded<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await run());
  } catch (e) {
    const problem = nodeProblem(e);
    if (problem) return problem;
    throw e;
  }
}

/**
 * Sending from one of the wallet's own addresses. Built per request; the only state is the
 * last send each address signed (`PendingSends`).
 */
export class SendService {
  constructor(private readonly deps: SendDeps) {}

  async prepare(req: SendPrepareRequest): Promise<Result<SendQuote>> {
    if (!isBzeAddress(req.to)) {
      return fail(SendErrorCodes.invalidAddress, 'This is not a BeeZee address.');
    }
    const token = await this.token(req.denom);
    if (!token.ok) return token;
    const typed = req.max === true ? null : parseAmount(req.amount.trim(), token.value.decimals);
    if (typed instanceof Error) return fail(SendErrorCodes.invalidAmount, typed.message);
    if (typed === 0n) return fail(SendErrorCodes.invalidAmount, 'Enter an amount above zero.');

    const context = await this.context(req.fromIndex, [
      req.denom,
      ...(req.feeDenom === undefined ? [] : [req.feeDenom]),
    ]);
    if (!context.ok) return context;
    const ctx = context.value;
    const balance = ctx.balances.get(req.denom) ?? 0n;
    if (typed !== null && typed > balance) {
      return fail(SendErrorCodes.insufficientFunds, 'This address holds less than that.');
    }
    if (balance === 0n) {
      return fail(SendErrorCodes.insufficientFunds, 'This address holds none of this token.');
    }

    const pubKey = await this.pubKeyForSimulation(ctx);
    const data = await guarded(() => this.deps.fees.feeData());
    if (!data.ok) return data;
    // `typed` is null exactly for max. It starts one unit short of the balance: the fee is
    // simulated with a real fee coin of one unit, which may be in the token being sent.
    let amount = typed ?? (balance > 1n ? balance - 1n : balance);
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const estimate = await this.estimate(ctx, pubKey, req, amount);
      if (!estimate.ok) {
        // The whole balance (typed, or max of a single unit) leaves nothing for a fee coin of the
        // sent token; when no other token could be simulated either, say what to do about it.
        if (amount === balance && estimate.error.code === SendErrorCodes.simulationFailed) {
          return fail(LEAVES_NO_FEE.code, LEAVES_NO_FEE.message);
        }
        return estimate;
      }
      const priced = await this.price(estimate.value, data.value, ctx, req, amount, typed === null);
      if (!priced.ok) return priced;
      const { fee, options, override, reset } = priced.value;
      // Max sends what the fee leaves of the balance, or all of it when the fee is in another token.
      const settled =
        typed !== null ? amount : fee.denom === req.denom ? balance - BigInt(fee.amount) : balance;
      if (settled <= 0n) {
        return fail(SendErrorCodes.insufficientFunds, 'Nothing is left to send after the fee.');
      }
      // The amount is part of the transaction and so of its gas: a max send paid in the sent
      // token is simulated again with the amount it will really carry.
      if (settled !== amount) {
        amount = settled;
        continue;
      }
      return ok({
        network: this.deps.network.id,
        from: { index: ctx.from.index, address: ctx.from.address },
        to: req.to,
        token: {
          denom: token.value.denom,
          symbol: token.value.symbol,
          decimals: token.value.decimals,
        },
        amount: amount.toString(),
        balance: balance.toString(),
        gasLimit: fee.gasLimit,
        fee,
        options,
        ...(override === undefined ? {} : { override }),
        ...(reset ? { overrideReset: true as const } : {}),
      });
    }
    return fail(SendErrorCodes.reviewChanged, 'The fee keeps changing. Try again.');
  }

  async submit(req: SendSubmitRequest): Promise<Result<{ txHash: string; unconfirmed?: true }>> {
    if (!isBzeAddress(req.to)) {
      return fail(SendErrorCodes.invalidAddress, 'This is not a BeeZee address.');
    }
    if (![req.amount, req.feeAmount, req.gasLimit].every((n) => BASE_UNITS.test(n))) {
      return fail(ErrorCodes.badRequest, 'send.submit got a malformed quote.');
    }
    const amount = BigInt(req.amount);
    const reviewedFee = BigInt(req.feeAmount);
    if (amount === 0n) return fail(SendErrorCodes.invalidAmount, 'Enter an amount above zero.');
    // Only on the network it was reviewed on, which is the one the signature names.
    if (req.network !== this.deps.network.id) {
      return fail(SendErrorCodes.reviewChanged, 'The network changed. Review the send again.');
    }

    // Before any network call: a weak lock asks for the password and the UI retries.
    const { state } = await this.deps.wallet.state();
    if (state === 'weakLocked') {
      return fail(WalletErrorCodes.needsPassword, 'Enter your password to approve this.');
    }
    if (state !== 'unlocked') return fail(WalletErrorCodes.locked, 'The wallet is locked.');

    const context = await this.context(req.fromIndex, [req.denom, req.feeDenom]);
    if (!context.ok) return context;
    const ctx = context.value;
    // Only from the address that was reviewed: the wallet behind the index may have changed.
    if (ctx.from.address !== req.fromAddress) {
      return fail(SendErrorCodes.reviewChanged, 'The sending address changed. Review it again.');
    }
    // Right after a signed send, or while one is being signed, another one waits: the first
    // may still be on its way. The claim is taken before anything is signed.
    const address = ctx.from.address;
    const earlier = await this.deps.pending.claim(address, this.deps.clock.now());
    if (earlier === null) {
      return fail(
        SendErrorCodes.pendingSend,
        'A previous send is still pending. Check Activity before you send again.',
      );
    }
    try {
      return await this.signAndSend(req, ctx, amount, reviewedFee, earlier);
    } finally {
      await this.deps.pending.release(address);
    }
  }

  /** Checks, signs and broadcasts the reviewed quote; runs under the address's claim. */
  private async signAndSend(
    req: SendSubmitRequest,
    ctx: Context,
    amount: bigint,
    reviewedFee: bigint,
    earlier: PendingSend[],
  ): Promise<Result<{ txHash: string; unconfirmed?: true }>> {
    const held = ctx.balances.get(req.denom) ?? 0n;
    const feeHeld = ctx.balances.get(req.feeDenom) ?? 0n;
    const spent = req.feeDenom === req.denom ? amount + reviewedFee : amount;
    if (spent > held || reviewedFee > feeHeld) {
      return fail(SendErrorCodes.insufficientFunds, 'This address no longer holds enough.');
    }

    const key = await this.deps.wallet.pubKey(ctx.from.address);
    if (!key.ok) return key;
    if (
      ctx.accountPubKey !== null &&
      !(
        ctx.accountPubKey.length === key.value.length &&
        ctx.accountPubKey.every((b, i) => b === key.value[i])
      )
    ) {
      return fail(
        SendErrorCodes.keyMismatch,
        "This address's key on the network is not the wallet's key. Nothing was signed.",
      );
    }

    // Simulate again right before signing, with the sequence just read.
    const bodyBytes = this.body(ctx, req.to, req.denom, amount);
    const estimate = await guarded(() =>
      this.deps.fees.estimate({
        bodyBytes,
        pubKey: key.value,
        sequence: ctx.sequence,
        balances: ctx.balances,
        // The reviewed fee's token is the one its kind of fee is simulated with.
        preferred: req.feeDenom,
        spent: new Map([[req.denom, amount]]),
      }),
    );
    if (!estimate.ok) return estimate;
    const current = estimate.value.options.find((o) => o.denom === req.feeDenom);
    if (!current) return fail(SendErrorCodes.cannotPayFee, CANNOT_PAY);
    const gasLimit = BigInt(req.gasLimit);
    const changed = fail(SendErrorCodes.reviewChanged, 'The network fee changed. Review it again.');
    // What was reviewed is what gets signed: any other fee goes back to the review screen.
    if (req.override === undefined) {
      if (current.amount !== reviewedFee || current.gasLimit !== gasLimit) return changed;
    } else {
      // Advanced settings are priced again on the fresh simulation, never taken from the popup.
      const data = await guarded(() => this.deps.fees.feeData());
      if (!data.ok) return data;
      const pricing = feePricing(data.value, req.feeDenom);
      if (!pricing) return fail(SendErrorCodes.cannotPayFee, CANNOT_PAY);
      const priced = priceGasOverride({
        pricing,
        gasUsed: current.gasUsed,
        gasLimit: BigInt(req.override.gasLimit),
        gasPrice: multiplierOf(req.override.gasPrice),
        spendable: feeHeld - (req.feeDenom === req.denom ? amount : 0n),
      });
      if (
        priced.status === 'low' ||
        priced.status === 'high' ||
        priced.status === 'afford' ||
        priced.amount !== reviewedFee ||
        BigInt(req.override.gasLimit) !== gasLimit
      ) {
        return changed;
      }
    }

    const authInfoBytes = buildAuthInfo({
      pubKey: key.value,
      sequence: ctx.sequence,
      fee: {
        amount: [{ denom: req.feeDenom, amount: reviewedFee.toString() }],
        gasLimit,
      },
    });
    const signature = await this.deps.wallet.signDirect(
      ctx.from.address,
      signDocBytes({
        bodyBytes,
        authInfoBytes,
        chainId: this.deps.network.chainId,
        accountNumber: ctx.accountNumber,
      }),
    );
    if (!signature.ok) return signature;

    const txRaw = txRawBytes({ bodyBytes, authInfoBytes, signatures: [signature.value] });
    // The hash is known before the node answers, so a lost answer can still be followed up.
    const hash = txHash(txRaw);
    // Recorded before it leaves: whatever the node answers, this send may land.
    await this.deps.pending.record(
      ctx.from.address,
      {
        txHash: hash,
        sequence: ctx.sequence.toString(),
        timeoutHeight: this.timeoutHeight(ctx).toString(),
        signedAt: this.deps.clock.now(),
      },
      ctx.height,
    );
    const sent = await this.broadcast(txRaw, hash, earlier, ctx.height);
    if (!sent.ok) return sent;
    await this.deps.wallet.rearm();
    return sent;
  }

  /**
   * The node's answer, read for what it proves. Only a refusal of a send that never went out
   * before is a failure; anything that may still land is an unknown outcome with the local hash.
   */
  private async broadcast(
    txRaw: Uint8Array,
    hash: string,
    earlier: PendingSend[],
    height: bigint,
  ): Promise<Result<{ txHash: string; unconfirmed?: true }>> {
    const unknown = ok({ txHash: hash, unconfirmed: true as const });
    try {
      const sent = await this.deps.chain.broadcast(txRaw);
      return sent.txHash.toUpperCase() === hash ? ok({ txHash: hash }) : unknown;
    } catch (e) {
      if (
        e instanceof TransportError ||
        e instanceof HttpStatusError ||
        e instanceof UnexpectedResponseError
      ) {
        return unknown;
      }
      if (e instanceof BroadcastError) {
        if (e.codespace === ALREADY_SENT.codespace && e.code === ALREADY_SENT.code) return unknown;
        // An earlier send of this address can still be included: this refusal says nothing of it.
        if (earlier.some((p) => BigInt(p.timeoutHeight) >= height)) return unknown;
      }
      const problem = nodeProblem(e);
      if (problem) return problem;
      throw e;
    }
  }

  async status(txHash: string): Promise<Result<TxStatus & { explorerUrl: string }>> {
    if (!TX_HASH.test(txHash)) return fail(ErrorCodes.badRequest, 'Not a transaction hash.');
    const explorerUrl = `${this.deps.network.scan}/txs/${txHash}`;
    try {
      const tx = await this.deps.chain.waitForTx(txHash, {
        clock: this.deps.clock,
        intervalMs: STATUS_INTERVAL_MS,
        timeoutMs: STATUS_TIMEOUT_MS,
      });
      // Found committed: the next send need not wait. A reported failure keeps the wait.
      if (tx.code === 0) await this.deps.pending.settle(txHash);
      return ok(
        tx.code === 0
          ? {
              status: 'confirmed',
              height: tx.height.toString(),
              gasUsed: tx.gasUsed.toString(),
              explorerUrl,
            }
          : { status: 'failed', message: tx.rawLog, explorerUrl },
      );
    } catch (e) {
      if (e instanceof TxTimeoutError) return ok({ status: 'pending', explorerUrl });
      const problem = nodeProblem(e);
      if (problem) return problem;
      throw e;
    }
  }

  /** Resolves the token's real decimals; a guess (fallback) would mis-scale the amount. */
  private async token(denom: string): Promise<Result<TokenInfo>> {
    try {
      const info = await this.deps.tokens.resolve(denom);
      if (info.source === 'fallback') throw new Error('guessed token data');
      return ok(info);
    } catch {
      return fail(SendErrorCodes.tokenUnavailable, "This token's details could not be read.");
    }
  }

  /** The sender's account and balances; `denoms` (and every fee token) with exact amounts. */
  private async context(fromIndex: number, denoms: string[]): Promise<Result<Context>> {
    const addresses = await this.deps.wallet.addresses();
    if (!addresses.ok) return addresses;
    const from = addresses.value.addresses.find((a) => a.index === fromIndex);
    if (!from) return fail(SendErrorCodes.unknownAddress, 'No such address.');
    const read = await guarded(async () => {
      const [account, listed, height] = await Promise.all([
        this.deps.chain.account(from.address),
        this.deps.chain.balances(from.address),
        this.deps.chain.latestHeight(),
      ]);
      // A list cut short may miss the tokens this send needs: those are read on their own.
      const balances = balancesMayBeCut(listed)
        ? await withBalancesOf(this.deps.chain, from.address, listed, [
            ...denoms,
            ...(await this.deps.fees.feeData()).rates.keys(),
          ])
        : listed;
      return { account, balances, height };
    });
    if (!read.ok) return read;
    const { account, balances, height } = read.value;
    if (account === null) return fail(SendErrorCodes.fundFirst, 'Fund this address first.');
    return ok({
      from,
      sequence: account.sequence,
      accountNumber: account.accountNumber,
      accountPubKey: account.pubKey,
      balances,
      height,
    });
  }

  /** The last block that may include a send built now. */
  private timeoutHeight(ctx: Context): bigint {
    return ctx.height + TIMEOUT_BLOCKS;
  }

  /** Review works in the weak lock too, where no key can be derived: the simulation does not need it. */
  private async pubKeyForSimulation(ctx: Context): Promise<Uint8Array> {
    const derived = await this.deps.wallet.pubKey(ctx.from.address);
    return derived.ok ? derived.value : (ctx.accountPubKey ?? SIMULATION_PUBKEY);
  }

  /** The body is simulated with the same expiry it is signed with, so the gas matches. */
  private body(ctx: Context, to: string, denom: string, amount: bigint): Uint8Array {
    return buildBody({
      timeoutHeight: this.timeoutHeight(ctx),
      messages: [
        encodeMsgSend({
          fromAddress: ctx.from.address,
          toAddress: to,
          amount: [{ denom, amount: amount.toString() }],
        }),
      ],
    });
  }

  private estimate(
    ctx: Context,
    pubKey: Uint8Array,
    req: SendPrepareRequest,
    amount: bigint,
  ): Promise<Result<FeeEstimate>> {
    return guarded(() =>
      this.deps.fees.estimate({
        bodyBytes: this.body(ctx, req.to, req.denom, amount),
        pubKey,
        sequence: ctx.sequence,
        balances: ctx.balances,
        // A picked fee token is the one a fee in another token is simulated with. The amount is
        // spent first, so a token with no unit left next to it is never simulated as the fee.
        preferred: req.feeDenom ?? req.denom,
        spent: new Map([[req.denom, amount]]),
      }),
    );
  }

  /**
   * The fee tokens this send can really pay with. The estimator only checks that the fee fits
   * the balance; when the fee is paid in the token being sent, the amount has to fit as well.
   * Advanced settings for the picked token replace its fee when they still fit this send; a
   * limit the fresh simulation no longer allows is dropped (`reset`).
   */
  private async price(
    estimate: FeeEstimate,
    data: FeeData,
    ctx: Context,
    req: SendPrepareRequest,
    amount: bigint,
    max: boolean,
  ): Promise<
    Result<{ fee: FeeChoice; options: FeeChoice[]; override?: FeeOverride; reset: boolean }>
  > {
    if (estimate.options.length === 0) {
      return fail(SendErrorCodes.cannotPayFee, CANNOT_PAY);
    }
    const balance = ctx.balances.get(req.denom) ?? 0n;
    const affordable = estimate.options.filter(
      (o) => o.denom !== req.denom || (max ? o.amount < balance : amount + o.amount <= balance),
    );
    if (affordable.length === 0) {
      return fail(LEAVES_NO_FEE.code, LEAVES_NO_FEE.message);
    }
    const options: FeeChoice[] = [];
    for (const o of affordable) {
      // An option whose token cannot be read is left out: its fee could not be shown right.
      const info = await this.token(o.denom);
      const pricing = feePricing(data, o.denom);
      if (info.ok) {
        options.push({
          denom: o.denom,
          amount: o.amount.toString(),
          gasLimit: o.gasLimit.toString(),
          gasUsed: o.gasUsed.toString(),
          symbol: info.value.symbol,
          decimals: info.value.decimals,
          logo: info.value.logo,
          balance: (ctx.balances.get(o.denom) ?? 0n).toString(),
          ...(pricing ? { pricing: pricingToWire(pricing) } : {}),
        });
      }
    }
    // A picked token first; else the sent token if it can pay, else BZE, else the first one.
    const wanted = [req.feeDenom, req.denom, NATIVE_DENOM];
    const fee =
      wanted.map((d) => options.find((o) => o.denom === d)).find((o) => o !== undefined) ??
      options[0];
    if (!fee) return fail(SendErrorCodes.cannotPayFee, CANNOT_PAY);
    const { override } = req;
    const pricing = feePricing(data, fee.denom);
    if (override === undefined || fee.denom !== req.feeDenom || !pricing) {
      return ok({ fee, options, reset: override !== undefined });
    }
    const held = ctx.balances.get(fee.denom) ?? 0n;
    // A max send in the fee's own token sends what the fee leaves, so only one unit must stay.
    const sent = fee.denom === req.denom ? (max ? 1n : amount) : 0n;
    const priced = priceGasOverride({
      pricing,
      gasUsed: BigInt(fee.gasUsed),
      gasLimit: BigInt(override.gasLimit),
      gasPrice: multiplierOf(override.gasPrice),
      spendable: held - sent,
    });
    // Settings that no longer fit (a new simulation, a larger amount) give way to the estimate,
    // which `options` has already checked against the balance.
    if (priced.status === 'low' || priced.status === 'high' || priced.status === 'afford') {
      return ok({ fee, options, reset: true });
    }
    const custom: FeeChoice = {
      ...fee,
      amount: priced.amount.toString(),
      gasLimit: override.gasLimit,
    };
    // The options keep their own fees: Advanced starts from the picked one's estimate.
    return ok({ fee: custom, options, override, reset: false });
  }
}
