import {
  BroadcastError,
  HttpStatusError,
  NATIVE_DENOM,
  SimulationError,
  TransportError,
  TxTimeoutError,
  UnexpectedResponseError,
  buildAuthInfo,
  buildBody,
  encodeMsgSend,
  isBzeAddress,
  parseAmount,
  signDocBytes,
  txHash,
  txRawBytes,
  type ChainClient,
  type Clock,
  type FeeEstimate,
  type FeeEstimator,
  type Network,
  type TokenInfo,
} from '@beepocket/core';
import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import { SendErrorCodes } from '../../protocol/send';
import type {
  FeeChoice,
  SendPrepareRequest,
  SendQuote,
  SendSubmitRequest,
  TxStatus,
} from '../../protocol/send';
import { WalletErrorCodes, type WalletAddress, type WalletState } from '../../protocol/wallet';

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
  network: Pick<Network, 'chainId' | 'scan'>;
  chain: Pick<ChainClient, 'account' | 'balances' | 'broadcast' | 'waitForTx'>;
  fees: Pick<FeeEstimator, 'estimate'>;
  tokens: { resolve(denom: string): Promise<TokenInfo> };
  wallet: SendWallet;
  clock: Clock;
}

/** Waiting for inclusion: poll every second for up to a minute (Technical Design §7). */
export const STATUS_INTERVAL_MS = 1000;
export const STATUS_TIMEOUT_MS = 60_000;

/** The simulation does not verify signatures, so an address that never sent can use this key. */
const SIMULATION_PUBKEY = Uint8Array.from([2, ...new Array<number>(32).fill(1)]);
/** Passes to settle the fee of a max send paid in the sent token (the amount feeds the gas). */
const MAX_PASSES = 5;
const TX_HASH = /^[0-9A-Fa-f]{64}$/;
const BASE_UNITS = /^\d{1,60}$/;

interface Context {
  from: WalletAddress;
  sequence: bigint;
  accountNumber: bigint;
  accountPubKey: Uint8Array | null;
  balances: Map<string, bigint>;
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
async function guarded<T>(run: () => Promise<T>): Promise<Result<T>>;
/** With `unknownOutcome`, an answer that never arrived gives `null` (the request may have landed). */
async function guarded<T>(run: () => Promise<T>, unknownOutcome: true): Promise<Result<T | null>>;
async function guarded<T>(
  run: () => Promise<T>,
  unknownOutcome = false,
): Promise<Result<T | null>> {
  try {
    return ok(await run());
  } catch (e) {
    if (
      unknownOutcome &&
      (e instanceof TransportError ||
        e instanceof HttpStatusError ||
        e instanceof UnexpectedResponseError)
    ) {
      return ok(null);
    }
    const problem = nodeProblem(e);
    if (problem) return problem;
    throw e;
  }
}

/** Sending from one of the wallet's own addresses. Built per request; holds no state. */
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

    const context = await this.context(req.fromIndex);
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
    // `typed` is null exactly for max, which starts from the whole balance.
    let amount = typed ?? balance;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const estimate = await this.estimate(ctx, pubKey, req, amount);
      if (!estimate.ok) return estimate;
      const priced = await this.price(estimate.value, ctx, req, amount, typed === null);
      if (!priced.ok) return priced;
      const { fee, options } = priced.value;
      const settled =
        typed === null && fee.denom === req.denom ? balance - BigInt(fee.amount) : amount;
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
        from: { index: ctx.from.index, address: ctx.from.address },
        to: req.to,
        token: {
          denom: token.value.denom,
          symbol: token.value.symbol,
          decimals: token.value.decimals,
        },
        amount: amount.toString(),
        balance: balance.toString(),
        gasLimit: estimate.value.gasLimit.toString(),
        fee,
        options,
      });
    }
    return fail(SendErrorCodes.reviewChanged, 'The fee keeps changing. Try again.');
  }

  async submit(req: SendSubmitRequest): Promise<Result<{ txHash: string }>> {
    if (!isBzeAddress(req.to)) {
      return fail(SendErrorCodes.invalidAddress, 'This is not a BeeZee address.');
    }
    if (![req.amount, req.feeAmount, req.gasLimit].every((n) => BASE_UNITS.test(n))) {
      return fail(ErrorCodes.badRequest, 'send.submit got a malformed quote.');
    }
    const amount = BigInt(req.amount);
    const reviewedFee = BigInt(req.feeAmount);
    if (amount === 0n) return fail(SendErrorCodes.invalidAmount, 'Enter an amount above zero.');

    // Before any network call: a weak lock asks for the password and the UI retries.
    const { state } = await this.deps.wallet.state();
    if (state === 'weakLocked') {
      return fail(WalletErrorCodes.needsPassword, 'Enter your password to approve this.');
    }
    if (state !== 'unlocked') return fail(WalletErrorCodes.locked, 'The wallet is locked.');

    const context = await this.context(req.fromIndex);
    if (!context.ok) return context;
    const ctx = context.value;
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
        preferred: req.denom,
      }),
    );
    if (!estimate.ok) return estimate;
    const current = estimate.value.options.find((o) => o.denom === req.feeDenom);
    if (!current)
      return fail(SendErrorCodes.cannotPayFee, "This address can't pay the network fee.");
    // What was reviewed is what gets signed: any other fee goes back to the review screen.
    if (current.amount !== reviewedFee || estimate.value.gasLimit !== BigInt(req.gasLimit)) {
      return fail(SendErrorCodes.reviewChanged, 'The network fee changed. Review it again.');
    }

    const authInfoBytes = buildAuthInfo({
      pubKey: key.value,
      sequence: ctx.sequence,
      fee: {
        amount: [{ denom: req.feeDenom, amount: reviewedFee.toString() }],
        gasLimit: estimate.value.gasLimit,
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
    const sent = await guarded(() => this.deps.chain.broadcast(txRaw), true);
    if (!sent.ok) return sent;
    await this.deps.wallet.rearm();
    if (sent.value === null) return ok({ txHash: hash, unconfirmed: true });
    return ok({ txHash: sent.value.txHash });
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

  private async context(fromIndex: number): Promise<Result<Context>> {
    const addresses = await this.deps.wallet.addresses();
    if (!addresses.ok) return addresses;
    const from = addresses.value.addresses.find((a) => a.index === fromIndex);
    if (!from) return fail(SendErrorCodes.unknownAddress, 'No such address.');
    const read = await guarded(async () => {
      const [account, balances] = await Promise.all([
        this.deps.chain.account(from.address),
        this.deps.chain.balances(from.address),
      ]);
      return { account, balances };
    });
    if (!read.ok) return read;
    const { account, balances } = read.value;
    if (account === null) return fail(SendErrorCodes.fundFirst, 'Fund this address first.');
    return ok({
      from,
      sequence: account.sequence,
      accountNumber: account.accountNumber,
      accountPubKey: account.pubKey,
      balances,
    });
  }

  /** Review works in the weak lock too, where no key can be derived: the simulation does not need it. */
  private async pubKeyForSimulation(ctx: Context): Promise<Uint8Array> {
    const derived = await this.deps.wallet.pubKey(ctx.from.address);
    return derived.ok ? derived.value : (ctx.accountPubKey ?? SIMULATION_PUBKEY);
  }

  private body(ctx: Context, to: string, denom: string, amount: bigint): Uint8Array {
    return buildBody({
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
        preferred: req.denom,
      }),
    );
  }

  /**
   * The fee tokens this send can really pay with. The estimator only checks that the fee fits
   * the balance; when the fee is paid in the token being sent, the amount has to fit as well.
   */
  private async price(
    estimate: FeeEstimate,
    ctx: Context,
    req: SendPrepareRequest,
    amount: bigint,
    max: boolean,
  ): Promise<Result<{ fee: FeeChoice; options: FeeChoice[] }>> {
    if (estimate.options.length === 0) {
      return fail(SendErrorCodes.cannotPayFee, "This address can't pay the network fee.");
    }
    const balance = ctx.balances.get(req.denom) ?? 0n;
    const affordable = estimate.options.filter(
      (o) => o.denom !== req.denom || (max ? o.amount < balance : amount + o.amount <= balance),
    );
    if (affordable.length === 0) {
      return fail(SendErrorCodes.amountLeavesNoFee, 'Leave room for the network fee, or use max.');
    }
    const options: FeeChoice[] = [];
    for (const o of affordable) {
      // An option whose token cannot be read is left out: its fee could not be shown right.
      const info = await this.token(o.denom);
      if (info.ok) {
        options.push({
          denom: o.denom,
          amount: o.amount.toString(),
          symbol: info.value.symbol,
          decimals: info.value.decimals,
          logo: info.value.logo,
          balance: (ctx.balances.get(o.denom) ?? 0n).toString(),
        });
      }
    }
    // A picked token first; else the sent token if it can pay, else BZE, else the first one.
    const wanted = [req.feeDenom, req.denom, NATIVE_DENOM];
    const fee =
      wanted.map((d) => options.find((o) => o.denom === d)).find((o) => o !== undefined) ??
      options[0];
    if (!fee) return fail(SendErrorCodes.cannotPayFee, "This address can't pay the network fee.");
    return ok({ fee, options });
  }
}
