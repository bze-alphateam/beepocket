import { GOVERNANCE_ONLY } from './governance';
import { base64 } from '@scure/base';
import { formatAmount, displayPrice } from './amounts';
import { decodeAny } from './decode';
import type {
  ChainClient,
  CoinAmount,
  Market,
  MarketOrder,
  Pool,
  TokenFactoryParams,
  TradebinParams,
} from './net';
import { MsgMultiSend, MsgSend } from './proto/cosmos/bank/v1beta1/tx';
import {
  MsgBeginRedelegate,
  MsgCancelUnbondingDelegation,
  MsgDelegate,
  MsgUndelegate,
} from './proto/cosmos/staking/v1beta1/tx';
import {
  MsgDepositValidatorRewardsPool,
  MsgFundCommunityPool,
  MsgSetWithdrawAddress,
  MsgWithdrawDelegatorReward,
} from './proto/cosmos/distribution/v1beta1/tx';
import {
  MsgCreatePeriodicVestingAccount,
  MsgCreatePermanentLockedAccount,
  MsgCreateVestingAccount,
} from './proto/cosmos/vesting/v1beta1/tx';
import type { Period } from './proto/cosmos/vesting/v1beta1/vesting';
import { MsgTransfer } from './proto/ibc/applications/transfer/v1/tx';
import { SendAuthorization } from './proto/cosmos/bank/v1beta1/authz';
import { GenericAuthorization, Grant } from './proto/cosmos/authz/v1beta1/authz';
import { MsgExec, MsgGrant } from './proto/cosmos/authz/v1beta1/tx';
import type { Coin } from './proto/cosmos/base/v1beta1/coin';
import { VoteOption } from './proto/cosmos/gov/v1/gov';
import { MsgDeposit, MsgVote } from './proto/cosmos/gov/v1/tx';
import { MsgGrantAllowance } from './proto/cosmos/feegrant/v1beta1/tx';
import {
  AllowedMsgAllowance,
  BasicAllowance,
  PeriodicAllowance,
} from './proto/cosmos/feegrant/v1beta1/feegrant';
import { AuthorizationType, StakeAuthorization } from './proto/cosmos/staking/v1beta1/authz';
import { TransferAuthorization } from './proto/ibc/applications/transfer/v1/authz';
import {
  MsgFundBurner,
  MsgJoinRaffle,
  MsgMoveIbcLockedCoins,
  MsgStartRaffle,
} from './proto/bze/burner/tx';
import {
  MsgAddLiquidity,
  MsgCancelOrder,
  MsgCreateLiquidityPool,
  MsgCreateMarket,
  MsgCreateOrder,
  MsgFillOrders,
  MsgMultiSwap,
  MsgRemoveLiquidity,
} from './proto/bze/tradebin/tx';
import * as rewards from './proto/bze/rewards/tx';
import type {
  MsgCreateDenomRewardSchedule,
  MsgCreateStakingReward,
  MsgCreateTradingReward,
  MsgDistributeDenomRewards,
  MsgDistributeStakingRewards,
  MsgJoinDenomReward,
  MsgJoinStaking,
  MsgUpdateDenomRewardSchedule,
  MsgUpdateStakingReward,
} from './proto/bze/rewards/tx';
import * as factory from './proto/bze/tokenfactory/tx';
import type {
  MsgChangeAdmin,
  MsgSetDenomBranding,
  MsgSetDenomMetadata,
} from './proto/bze/tokenfactory/tx';
import { MsgAddArticle, MsgPayPublisherRespect } from './proto/bze/cointrunk/tx';
import {
  MsgAcceptAdminNomination,
  MsgAdminExecute,
  MsgCancelProposal,
  MsgCleanupProposal,
  MsgCreateDao,
  MsgNominateAdmin,
  MsgSettleProposal,
  MsgSubmitProposal,
  MsgUpdateDaoConfig,
  MsgUpdateElectorate,
  MsgUpdateMembers,
  MsgUpdateMetadata,
  MsgVote as DaoMsgVote,
  MsgWithdrawAdminNomination,
} from './proto/bze/dao/tx';
import {
  DaoType,
  DepositRefundPolicy,
  FundsDestination,
  VoteOption as DaoVoteOption,
  type DaoConfig,
  type StakeElectorate,
} from './proto/bze/dao/store';
import * as guardian from './proto/bze/guardian/v1/tx';
import type { Duration } from './proto/google/protobuf/duration';
import { bzeAddressHash, signersOf } from './signers';
import { sanitiseText } from './text';
import { labelText, tokenLabel } from './lookalike';
import { LP_DECIMALS, NATIVE_DENOM, type TokenInfo } from './tokens';
import type { AnyMsg } from './tx';
import { shortAddress } from './vault';

export type RiskLevel = 'normal' | 'unknown' | 'dangerous';

export type MsgIcon =
  | 'send'
  | 'swap'
  | 'order'
  | 'cancel'
  | 'liquidity'
  | 'burn'
  | 'raffle'
  | 'vote'
  | 'grant'
  | 'stake'
  | 'rewards'
  | 'create'
  | 'admin'
  | 'edit'
  | 'article'
  | 'settings'
  | 'unknown';

/** `[label, value]`, or `[label, value, 'mono']` for text shown in a monospace face. */
export type SummaryRow = [label: string, value: string] | [label: string, value: string, 'mono'];

/** Text for the red box of a dangerous message. */
export interface DangerNotice {
  title: string;
  text: string;
}

export interface MsgSummary {
  typeUrl: string;
  level: RiskLevel;
  icon: MsgIcon;
  title: string;
  /** One line for a message card: the hero and the sub text of the message. */
  line: string;
  /** What the message does, in a few words, and the detail under it. */
  hero: string;
  sub: string;
  /** The message's own rows, the same ones a single-message summary shows. */
  rows: SummaryRow[];
  danger: DangerNotice | null;
  /** A type the wallet cannot read at all: approving it needs the user's explicit tick. */
  unreadable: boolean;
}

export interface TxSummary {
  /** The riskiest level of any message. */
  level: RiskLevel;
  title: string;
  hero: string;
  sub: string;
  rows: SummaryRow[];
  messages: MsgSummary[];
  /** Red-box texts of every dangerous message. */
  dangers: DangerNotice[];
  /** The transaction memo as untrusted text: sanitised, bounded, `null` when empty. */
  memo: string | null;
}

export interface SummaryContext {
  /** Token display data; `TokenResolver` fits. */
  tokens: { resolve(denom: string): Promise<TokenInfo> };
  /** Markets and pools, for the pairs and routes messages refer to by id. */
  markets: Pick<ChainClient, 'markets' | 'liquidityPools'>;
  /** Open orders, for cancel requests. */
  orders: Pick<ChainClient, 'marketOrder'>;
  /** A saved contact's name for an address, or null. */
  addressBook: (address: string) => string | null;
  /** Chain params for the fees some messages pay on top of the network fee. */
  fees: Pick<ChainClient, 'tradebinParams' | 'tokenFactoryParams'>;
  /** Every address of the wallet, for messages that point at an address of its own. */
  ownAddresses: readonly string[];
}

export interface SummaryOptions {
  /** The transaction's memo, as the dapp wrote it. */
  memo?: string;
}

/** What one message says, before it is merged into a transaction summary. */
interface Parts {
  level: RiskLevel;
  icon: MsgIcon;
  title: string;
  hero: string;
  sub: string;
  rows: SummaryRow[];
  danger?: DangerNotice;
  /** Red-box texts of the messages an exec wraps. */
  nested?: DangerNotice[];
  /** Set only by `unknownParts`: the wallet cannot say what the message does. */
  unreadable?: true;
  /** The market a trade message acts on, for the shared-market line of a multi-message tx. */
  marketId?: string;
  marketPair?: string;
}

const MAX_TEXT = 128;
const MAX_UINT_DIGITS = 78;
const MAX_ROUTE_HOPS = 32;
const MAX_MEMO = 200;
const CREATION_FEE = "The chain's creation fee";
const TRADING_FEE = "The chain's trading fee";
const RISK_ORDER: Record<RiskLevel, number> = { normal: 0, unknown: 1, dangerous: 2 };

/** Untrusted text for display: no unsafe characters, bounded. */
const safeText = (raw: string, max = MAX_TEXT): string => sanitiseText(raw, max);

/**
 * A whole number written in plain decimal, or null for anything else: empty, a sign, a
 * leading zero, a prefix such as `0x`, separators.
 */
function toUint(raw: string): bigint | null {
  return raw.length > 0 && raw.length <= MAX_UINT_DIGITS && /^(0|[1-9]\d*)$/.test(raw)
    ? BigInt(raw)
    : null;
}

/** Whether every amount is a plain whole number. */
const allUint = (...amounts: string[]): boolean => amounts.every((a) => toUint(a) !== null);

function isDecimal(raw: string): boolean {
  return raw.length > 0 && raw.length <= 100 && /^\d+(\.\d+)?$/.test(raw);
}

function lastSegment(typeUrl: string): string {
  return safeText(typeUrl.split('.').pop() ?? typeUrl, 64);
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A price with at least four fraction digits: `0.3350`. */
function priceText(price: string): string {
  const [whole = '0', fraction = ''] = price.split('.');
  return `${group(whole)}.${fraction.padEnd(4, '0')}`;
}

/** `amount × price` in quote base units, rounded up (`up`) or down; price is a plain decimal. */
function totalQuote(amount: bigint, price: string, round: 'up' | 'down'): bigint {
  const [whole = '', fraction = ''] = price.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const product = amount * BigInt(whole + fraction);
  return round === 'up' ? (product + scale - 1n) / scale : product / scale;
}

interface TokenView {
  symbol: string;
  decimals: number;
  /** False when decimals are a guess: amounts are then base units. */
  exact: boolean;
}

/**
 * Most distinct tokens one summary looks up (BZE comes on top). Past it, a token shows in base
 * units under its denom: a request naming hundreds of tokens is not worth hundreds of lookups.
 */
const MAX_TOKEN_LOOKUPS = 32;

/** One summarising run's lookups: each is made at most once and never throws. */
class Lookups {
  private readonly tokenCache = new Map<string, Promise<TokenView>>();
  /** Tokens other than BZE looked up so far. */
  private lookups = 0;
  private marketsCache: Promise<Map<string, Market>> | undefined;
  private poolsCache: Promise<Map<string, Pool>> | undefined;
  private tradebinCache: Promise<TradebinParams | null> | undefined;
  private tokenFactoryCache: Promise<TokenFactoryParams | null> | undefined;

  private offlineLookups: Lookups | undefined;

  constructor(readonly ctx: SummaryContext) {}

  /** The same address book with no node calls: tokens, markets and orders are not found. */
  offline(): Lookups {
    if (!this.offlineLookups) {
      const offline = new Lookups({
        tokens: { resolve: () => Promise.reject(new Error('offline')) },
        markets: { markets: () => Promise.resolve([]), liquidityPools: () => Promise.resolve([]) },
        orders: { marketOrder: () => Promise.resolve(null) },
        addressBook: this.ctx.addressBook,
        fees: {
          tradebinParams: () => Promise.reject(new Error('offline')),
          tokenFactoryParams: () => Promise.reject(new Error('offline')),
        },
        ownAddresses: this.ctx.ownAddresses,
      });
      offline.offlineLookups = offline;
      this.offlineLookups = offline;
    }
    return this.offlineLookups;
  }

  token(denom: string): Promise<TokenView> {
    let cached = this.tokenCache.get(denom);
    if (!cached) {
      if (denom !== NATIVE_DENOM && this.lookups >= MAX_TOKEN_LOOKUPS) {
        return Promise.resolve({ symbol: safeText(denom, 40), decimals: 0, exact: false });
      }
      if (denom !== NATIVE_DENOM) this.lookups++;
      cached = this.ctx.tokens.resolve(denom).then(
        (t) => ({
          // A look-alike carries its marker and denom wherever the summary names it.
          symbol: labelText({
            ...tokenLabel(t),
            // Unsafe characters show as a placeholder here, as everywhere else in a summary.
            symbol: sanitiseText(t.symbol, 64),
          }),
          decimals: t.decimals,
          // LP shares always have LP_DECIMALS, so their fallback still reads in whole shares.
          exact: t.source !== 'fallback' || (t.kind === 'lp' && t.decimals === LP_DECIMALS),
        }),
        () => ({ symbol: safeText(denom, 40), decimals: 0, exact: false }),
      );
      this.tokenCache.set(denom, cached);
    }
    return cached;
  }

  async market(id: string): Promise<Market | null> {
    this.marketsCache ??= this.ctx.markets.markets().then(
      (list) => new Map(list.map((m) => [m.id, m])),
      () => new Map<string, Market>(),
    );
    return (await this.marketsCache).get(id) ?? null;
  }

  async pool(id: string): Promise<Pool | null> {
    this.poolsCache ??= this.ctx.markets.liquidityPools().then(
      (list) => new Map(list.map((p) => [p.id, p])),
      () => new Map<string, Pool>(),
    );
    return (await this.poolsCache).get(id) ?? null;
  }

  order(marketId: string, type: 'buy' | 'sell', id: string): Promise<MarketOrder | null> {
    return this.ctx.orders.marketOrder(marketId, type, id).catch(() => null);
  }

  /** Tradebin params, or null when they cannot be read. */
  tradebinParams(): Promise<TradebinParams | null> {
    this.tradebinCache ??= Promise.resolve()
      .then(() => this.ctx.fees.tradebinParams())
      .catch(() => null);
    return this.tradebinCache;
  }

  /** Token factory params, or null when they cannot be read. */
  tokenFactoryParams(): Promise<TokenFactoryParams | null> {
    this.tokenFactoryCache ??= Promise.resolve()
      .then(() => this.ctx.fees.tokenFactoryParams())
      .catch(() => null);
    return this.tokenFactoryCache;
  }

  /** A fee from chain params as text; `fallback` when it could not be read. */
  async fee(coin: CoinAmount | undefined, fallback: string): Promise<string> {
    if (!coin) return fallback;
    return coin.amount === 0n ? 'None' : this.money(coin.denom, coin.amount);
  }

  async creationFee(source: 'market' | 'token'): Promise<SummaryRow> {
    const coin =
      source === 'market'
        ? (await this.tradebinParams())?.createMarketFee
        : (await this.tokenFactoryParams())?.createDenomFee;
    return ['Creation fee', await this.fee(coin, CREATION_FEE)];
  }

  /** The fee of a fill or a swap, which always takes from the book or a pool. */
  async takerFee(): Promise<SummaryRow> {
    const params = await this.tradebinParams();
    return ['Trading fee', await this.fee(params?.marketTakerFee, TRADING_FEE)];
  }

  /** An order pays the maker fee when it waits on the book and the taker fee when it fills. */
  async orderFee(): Promise<SummaryRow> {
    const params = await this.tradebinParams();
    const maker = params?.marketMakerFee;
    const taker = params?.marketTakerFee;
    if (!maker || !taker) return ['Trading fee', TRADING_FEE];
    const [makerText, takerText] = await Promise.all([
      this.fee(maker, TRADING_FEE),
      this.fee(taker, TRADING_FEE),
    ]);
    return [
      'Trading fee',
      `${makerText} if it waits on the book, ${takerText} if it fills at once`,
    ];
  }

  /** Whether `address` is one of the wallet's own addresses, compared as bytes. */
  isOwn(address: string): boolean {
    return this.ctx.ownAddresses.some((own) => sameAddress(own, address));
  }

  /**
   * `1,000.00 BZE`; base units with a note when the token's decimals are unknown. `full` shows
   * every decimal the token has instead of cutting the display short.
   */
  async money(denom: string, amount: bigint | string, full = false): Promise<string> {
    const t = await this.token(denom);
    const value = typeof amount === 'bigint' ? amount : toUint(amount);
    if (value === null) return `${safeText(String(amount), 40)} ${t.symbol}`;
    const text = formatAmount(value, t.decimals, full ? { maxFraction: t.decimals } : {});
    return t.exact ? `${text} ${t.symbol}` : `${text} ${t.symbol} (base units)`;
  }

  async coins(coins: Coin[]): Promise<string> {
    const parts = await Promise.all(coins.map((c) => this.money(c.denom, c.amount)));
    return parts.join(', ');
  }

  /** A contact's name, or the shortened address. */
  who(address: string): string {
    const name = this.ctx.addressBook(address);
    return name ? safeText(name, 40) : shortAddress(safeText(address, 80));
  }

  async pair(base: string, quote: string): Promise<string> {
    const [b, q] = await Promise.all([this.token(base), this.token(quote)]);
    return `${b.symbol}/${q.symbol}`;
  }
}

const isAnyLike = (v: unknown): v is AnyMsg =>
  typeof v === 'object' &&
  v !== null &&
  'typeUrl' in v &&
  typeof v.typeUrl === 'string' &&
  'value' in v &&
  v.value instanceof Uint8Array;

function expiry(date: Date | undefined): string {
  if (date === undefined) return 'Never';
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function unknownParts(msg: AnyMsg, sub?: string): Parts {
  return {
    level: 'unknown',
    icon: 'unknown',
    title: lastSegment(msg.typeUrl),
    hero: 'Unknown message',
    sub: sub ?? safeText(msg.typeUrl),
    rows: [],
    unreadable: true,
  };
}

async function sendParts(l: Lookups, msg: MsgSend): Promise<Parts> {
  const to = l.who(msg.toAddress);
  const rows: SummaryRow[] = [['To', safeText(msg.toAddress, 80), 'mono']];
  for (const coin of msg.amount) rows.push(['Amount', await l.money(coin.denom, coin.amount)]);
  const [only] = msg.amount;
  const hero =
    msg.amount.length === 1 && only
      ? await l.money(only.denom, only.amount)
      : msg.amount.length === 0
        ? 'No tokens'
        : `${String(msg.amount.length)} tokens`;
  const readable = allUint(...msg.amount.map((c) => c.amount));
  return {
    level: readable ? 'normal' : 'unknown',
    icon: 'send',
    title: 'Send',
    hero,
    sub: `to ${to}`,
    rows,
  };
}

/** The denoms a swap route passes through, as symbols; unknown pools show their id. */
async function routePath(
  l: Lookups,
  msg: MsgMultiSwap,
): Promise<{ path: string[]; consistent: boolean }> {
  const path = [(await l.token(msg.input.denom)).symbol];
  let current: string | null = msg.input.denom;
  for (const id of msg.routes.slice(0, MAX_ROUTE_HOPS)) {
    const pool = await l.pool(id);
    const next: string | null =
      !pool || current === null
        ? null
        : pool.base === current
          ? pool.quote
          : pool.quote === current
            ? pool.base
            : null;
    path.push(next === null ? `[${safeText(id, 60)}]` : (await l.token(next)).symbol);
    current = next;
  }
  if (msg.routes.length > MAX_ROUTE_HOPS) path.push('…');
  const out = (await l.token(msg.minOutput.denom)).symbol;
  const consistent =
    msg.routes.length > 0 &&
    msg.routes.length <= MAX_ROUTE_HOPS &&
    // An unknown pool leaves the route unproven: the swap is not what it says until checked.
    current !== null &&
    current === msg.minOutput.denom;
  if (current === null || current !== msg.minOutput.denom) path.push(out);
  return { path, consistent };
}

async function swapParts(l: Lookups, msg: MsgMultiSwap): Promise<Parts> {
  const [pay, get, route, fee] = await Promise.all([
    l.money(msg.input.denom, msg.input.amount),
    l.money(msg.minOutput.denom, msg.minOutput.amount),
    routePath(l, msg),
    l.takerFee(),
  ]);
  return {
    // A route that does not end in the denom the swap promises is not what it says it is.
    level:
      route.consistent && allUint(msg.input.amount, msg.minOutput.amount) ? 'normal' : 'unknown',
    icon: 'swap',
    title: 'Swap',
    hero: pay,
    sub: `for at least ${get}`,
    rows: [['Route', route.path.join(' → ')], ['You pay', pay], ['You get at least', get], fee],
  };
}

function orderTitle(type: string, buy: string, sell: string, other: string): string {
  return type === 'buy' ? buy : type === 'sell' ? sell : other;
}

async function createOrderParts(l: Lookups, msg: MsgCreateOrder): Promise<Parts> {
  const known = msg.orderType === 'buy' || msg.orderType === 'sell';
  const title = orderTitle(msg.orderType, 'Buy order', 'Sell order', 'Order');
  const market = await l.market(msg.marketId);
  const amount = toUint(msg.amount);
  if (!market || amount === null || !isDecimal(msg.price)) {
    // Nothing to convert with: show what the message says, in the chain's units.
    return {
      level: known && amount !== null && isDecimal(msg.price) ? 'normal' : 'unknown',
      icon: 'order',
      title,
      hero: `${safeText(msg.amount, 40)} (base units)`,
      sub: `on ${safeText(msg.marketId)} at ${safeText(msg.price, 40)} (base units)`,
      rows: [
        ['Market', safeText(msg.marketId), 'mono'],
        ['Amount', `${safeText(msg.amount, 40)} (base units)`],
        ['Price', `${safeText(msg.price, 40)} (base units)`],
        await l.orderFee(),
      ],
      marketId: msg.marketId,
    };
  }
  const [base, quote] = await Promise.all([l.token(market.base), l.token(market.quote)]);
  const pair = `${base.symbol}/${quote.symbol}`;
  const exact = base.exact && quote.exact;
  const price = `${priceText(displayPrice(msg.price, base.decimals, quote.decimals))} ${quote.symbol}${exact ? '' : ' (base units)'}`;
  // A buyer pays at least this much; a seller gets at most this much.
  const total = totalQuote(amount, msg.price, msg.orderType === 'buy' ? 'up' : 'down');
  const amountText = await l.money(market.base, amount);
  return {
    level: known ? 'normal' : 'unknown',
    icon: 'order',
    title,
    hero: amountText,
    sub: `${pair} at ${price}`,
    rows: [
      ['Market', pair],
      ['Amount', amountText],
      ['Price', price],
      ['Total', await l.money(market.quote, total)],
      await l.orderFee(),
    ],
    marketId: market.id,
    marketPair: pair,
  };
}

async function cancelOrderParts(l: Lookups, msg: MsgCancelOrder): Promise<Parts> {
  const known = msg.orderType === 'buy' || msg.orderType === 'sell';
  const title = orderTitle(msg.orderType, 'Cancel buy order', 'Cancel sell order', 'Cancel order');
  const market = await l.market(msg.marketId);
  const pair = market ? await l.pair(market.base, market.quote) : null;
  const order =
    msg.orderType === 'buy' || msg.orderType === 'sell'
      ? await l.order(msg.marketId, msg.orderType, msg.orderId)
      : null;
  let hero = `Order ${safeText(msg.orderId, 40)}`;
  let sub = `on ${pair ?? safeText(msg.marketId)}`;
  if (order && market) {
    const [base, quote] = await Promise.all([l.token(market.base), l.token(market.quote)]);
    if (order.marketId === msg.marketId && isDecimal(order.price)) {
      hero = await l.money(market.base, order.amount);
      sub = `at ${priceText(displayPrice(order.price, base.decimals, quote.decimals))} ${quote.symbol}`;
    }
  }
  const marketRow: SummaryRow = pair
    ? ['Market', pair]
    : ['Market', safeText(msg.marketId), 'mono'];
  return {
    level: known ? 'normal' : 'unknown',
    icon: 'cancel',
    title,
    hero,
    sub,
    rows: [marketRow, ['Order id', safeText(msg.orderId, 40), 'mono']],
    marketId: msg.marketId,
    ...(pair ? { marketPair: pair } : {}),
  };
}

interface FillItem {
  amount: bigint;
  price: string;
}

async function fillOrdersParts(l: Lookups, msg: MsgFillOrders): Promise<Parts> {
  const market = await l.market(msg.marketId);
  const count = msg.orders.length;
  const orders = `${String(count)} ${count === 1 ? 'order' : 'orders'}`;
  // The type names the orders being filled; the signer takes the other side.
  const buying = msg.orderType === 'sell';
  const items: FillItem[] = [];
  for (const item of msg.orders) {
    const amount = toUint(item.amount);
    if (amount === null || !isDecimal(item.price)) break;
    items.push({ amount, price: item.price });
  }
  const known = msg.orderType === 'buy' || msg.orderType === 'sell';
  if (!market || !known || count === 0 || items.length !== count) {
    // Nothing to work the totals out with: list what the message says, in the chain's units.
    const side = msg.orderType === 'buy' ? 'you sell' : buying ? 'you buy' : '?';
    const pair = market ? await l.pair(market.base, market.quote) : safeText(msg.marketId);
    const marketRow: SummaryRow = market
      ? ['Market', pair]
      : ['Market', safeText(msg.marketId), 'mono'];
    return {
      level: 'unknown',
      icon: 'order',
      title: 'Fill orders',
      hero: orders,
      sub: `${pair} · ${side}`,
      rows: [
        marketRow,
        ...msg.orders.map((item, i): SummaryRow => [
          `Order ${String(i + 1)}`,
          `${safeText(item.amount, 40)} @ ${safeText(item.price, 40)} (base units)`,
        ]),
        await l.takerFee(),
      ],
      marketId: msg.marketId,
      ...(market ? { marketPair: pair } : {}),
    };
  }
  const [base, quote] = await Promise.all([l.token(market.base), l.token(market.quote)]);
  const pair = `${base.symbol}/${quote.symbol}`;
  const unit = `${quote.symbol}/${base.symbol}${base.exact && quote.exact ? '' : ' (base units)'}`;
  const rows: SummaryRow[] = [['Market', pair]];
  let baseTotal = 0n;
  let quoteTotal = 0n;
  for (const [i, item] of items.entries()) {
    baseTotal += item.amount;
    // Per order, so a buyer is never shown less than they can be charged and a seller never more
    // than a full fill pays.
    quoteTotal += totalQuote(item.amount, item.price, buying ? 'up' : 'down');
    const price = priceText(displayPrice(item.price, base.decimals, quote.decimals));
    const amount = await l.money(market.base, item.amount);
    rows.push([`Order ${String(i + 1)}`, `${amount} @ ${price} ${unit}`]);
  }
  // Shown in full on the side that is given up, so it is never cut short.
  const baseText = await l.money(market.base, baseTotal, !buying);
  const quoteText = await l.money(market.quote, quoteTotal, buying);
  const [hero, sub, baseLabel, quoteLabel] = buying
    ? [`You pay up to ${quoteText}`, `You get ${baseText}`, 'You get', 'You pay up to']
    : [`You get ${quoteText}`, `You pay ${baseText}`, 'You pay', 'You get'];
  rows.push([baseLabel, baseText], [quoteLabel, quoteText], await l.takerFee());
  return {
    level: 'normal',
    icon: 'order',
    title: 'Fill orders',
    hero,
    sub: `${sub} · ${pair} · ${orders}`,
    rows,
    marketId: market.id,
    marketPair: pair,
  };
}

async function poolPair(l: Lookups, poolId: string): Promise<{ pool: Pool | null; pair: string }> {
  const pool = await l.pool(poolId);
  return {
    pool,
    pair: pool ? await l.pair(pool.base, pool.quote) : `pool ${safeText(poolId, 80)}`,
  };
}

const lp = (amount: string): string => {
  const value = toUint(amount);
  return value === null ? safeText(amount, 40) : formatAmount(value, LP_DECIMALS);
};

async function addLiquidityParts(l: Lookups, msg: MsgAddLiquidity): Promise<Parts> {
  const { pool, pair } = await poolPair(l, msg.poolId);
  const [base, quote] = pool
    ? await Promise.all([l.money(pool.base, msg.baseAmount), l.money(pool.quote, msg.quoteAmount)])
    : [
        `${safeText(msg.baseAmount, 40)} (base units)`,
        `${safeText(msg.quoteAmount, 40)} (base units)`,
      ];
  return {
    level: allUint(msg.baseAmount, msg.quoteAmount, msg.minLpTokens) ? 'normal' : 'unknown',
    icon: 'liquidity',
    title: 'Add liquidity',
    hero: `${base} + ${quote}`,
    sub: pool ? `to the ${pair} pool` : `to ${pair}`,
    rows: [
      ['Pool', pair],
      ['Min LP tokens', lp(msg.minLpTokens)],
    ],
  };
}

async function removeLiquidityParts(l: Lookups, msg: MsgRemoveLiquidity): Promise<Parts> {
  const { pool, pair } = await poolPair(l, msg.poolId);
  const [base, quote] = pool
    ? await Promise.all([l.money(pool.base, msg.minBase), l.money(pool.quote, msg.minQuote)])
    : [`${safeText(msg.minBase, 40)} (base units)`, `${safeText(msg.minQuote, 40)} (base units)`];
  return {
    level: allUint(msg.lpTokens, msg.minBase, msg.minQuote) ? 'normal' : 'unknown',
    icon: 'liquidity',
    title: 'Remove liquidity',
    hero: `${lp(msg.lpTokens)} LP`,
    sub: pool ? `from the ${pair} pool` : `from ${pair}`,
    rows: [
      ['Pool', pair],
      ['You get at least', `${base} + ${quote}`],
    ],
  };
}

/** Coins as the chain's msg server reads them: `1000ubze,5factory/…/x`, whole units only. */
function parseCoinString(raw: string): Coin[] | null {
  if (raw.length === 0 || raw.length > 4096) return null;
  const coins = new Map<string, bigint>();
  for (const part of raw.split(',')) {
    const m = /^\s*(\d+)(?:\.\d+)?\s*([a-zA-Z][a-zA-Z0-9/:._-]{2,127})\s*$/.exec(part);
    const whole = m?.[1];
    const denom = m?.[2];
    if (!whole || !denom || whole.length > MAX_UINT_DIGITS) return null;
    coins.set(denom, (coins.get(denom) ?? 0n) + BigInt(whole));
  }
  return [...coins].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
}

async function burnParts(l: Lookups, msg: MsgFundBurner): Promise<Parts> {
  const coins = parseCoinString(msg.amount);
  const amount = coins ? await l.coins(coins) : safeText(msg.amount, 200);
  return {
    // Coins we cannot read are coins we cannot vouch for.
    level: coins ? 'normal' : 'unknown',
    icon: 'burn',
    title: 'Burn',
    hero: amount,
    sub: 'sent to the burner',
    rows: [['Amount', amount]],
  };
}

async function raffleParts(l: Lookups, msg: MsgJoinRaffle): Promise<Parts> {
  const symbol = (await l.token(msg.denom)).symbol;
  const tickets = msg.tickets.toString();
  return {
    level: 'normal',
    icon: 'raffle',
    title: 'Join raffle',
    hero: `${tickets} ${msg.tickets === 1n ? 'ticket' : 'tickets'}`,
    sub: `${symbol} raffle`,
    rows: [
      ['Raffle', symbol],
      ['Tickets', tickets],
      // The price is paid out of the wallet and not part of the message.
      ['Cost', `Tickets × the raffle's ticket price, paid in ${symbol}`],
    ],
  };
}

const VOTES: Partial<Record<VoteOption, string>> = {
  [VoteOption.VOTE_OPTION_YES]: 'Yes',
  [VoteOption.VOTE_OPTION_NO]: 'No',
  [VoteOption.VOTE_OPTION_NO_WITH_VETO]: 'No with veto',
  [VoteOption.VOTE_OPTION_ABSTAIN]: 'Abstain',
};

function voteParts(msg: MsgVote): Parts {
  const option = VOTES[msg.option];
  const id = msg.proposalId.toString();
  return {
    level: option ? 'normal' : 'unknown',
    icon: 'vote',
    title: 'Vote',
    hero: option ?? 'Unknown vote',
    sub: `on proposal #${id}`,
    rows: [
      ['Proposal', `#${id}`],
      ['Vote', option ?? 'Unknown vote'],
    ],
  };
}

const STAKE_ACTIONS: Partial<Record<AuthorizationType, string>> = {
  [AuthorizationType.AUTHORIZATION_TYPE_DELEGATE]: 'Delegate',
  [AuthorizationType.AUTHORIZATION_TYPE_UNDELEGATE]: 'Undelegate',
  [AuthorizationType.AUTHORIZATION_TYPE_REDELEGATE]: 'Redelegate',
  [AuthorizationType.AUTHORIZATION_TYPE_CANCEL_UNBONDING_DELEGATION]: 'Cancel unbonding',
};

/** What an authz grant allows, in words that do not understate it. */
async function permissionText(l: Lookups, grant: Grant): Promise<string> {
  const auth = grant.authorization;
  if (!isAnyLike(auth)) return 'Unknown permission';
  try {
    switch (auth.typeUrl) {
      case GenericAuthorization.typeUrl:
        return `Any ${lastSegment(GenericAuthorization.decode(auth.value).msg)}`;
      case SendAuthorization.typeUrl: {
        const send = SendAuthorization.decode(auth.value);
        const limit = send.spendLimit.length
          ? `up to ${await l.coins(send.spendLimit)}`
          : 'with no limit';
        const where = send.allowList.length
          ? ` to ${String(send.allowList.length)} chosen ${send.allowList.length === 1 ? 'address' : 'addresses'}`
          : ' to any address';
        return `Send ${limit}${where}`;
      }
      case StakeAuthorization.typeUrl: {
        const stake = StakeAuthorization.decode(auth.value);
        const action = STAKE_ACTIONS[stake.authorizationType] ?? 'Staking';
        return `${action} ${stake.maxTokens ? `up to ${await l.coins([stake.maxTokens])}` : 'with no limit'}`;
      }
      case TransferAuthorization.typeUrl: {
        const transfer = TransferAuthorization.decode(auth.value);
        const limits = await Promise.all(
          transfer.allocations.map((a) =>
            a.spendLimit.length ? l.coins(a.spendLimit) : Promise.resolve('no limit'),
          ),
        );
        return `IBC transfers (${limits.length ? limits.join('; ') : 'no limit'})`;
      }
      default:
        return lastSegment(auth.typeUrl);
    }
  } catch {
    return `${lastSegment(auth.typeUrl)} (unreadable)`;
  }
}

async function grantParts(l: Lookups, msg: MsgGrant): Promise<Parts> {
  const grantee = l.who(msg.grantee);
  const permission = await permissionText(l, msg.grant);
  return {
    level: 'dangerous',
    icon: 'grant',
    title: 'Grant permission',
    hero: permission,
    sub: `to ${grantee}`,
    rows: [
      ['Grantee', safeText(msg.grantee, 80), 'mono'],
      ['Permission', permission],
      ['Expires', expiry(msg.grant.expiration)],
    ],
    danger: grantDanger(grantee),
  };
}

/** The red box of an authz grant; `grantee` is display text. */
function grantDanger(grantee: string): DangerNotice {
  return {
    title: `This gives ${grantee} power over your address`,
    text: 'They can make transactions from this address until the permission expires or you revoke it.',
  };
}

/** The spending limit of a fee allowance and when it ends. */
async function allowanceLimit(
  l: Lookups,
  allowance: unknown,
  depth = 0,
): Promise<{ limit: string; expires: string }> {
  const unknown = { limit: 'Unknown limit', expires: 'Unknown' };
  if (!isAnyLike(allowance) || depth > 4) return unknown;
  try {
    const basic = async (a: BasicAllowance) => ({
      limit: a.spendLimit.length ? await l.coins(a.spendLimit) : 'No limit',
      expires: expiry(a.expiration),
    });
    switch (allowance.typeUrl) {
      case BasicAllowance.typeUrl:
        return await basic(BasicAllowance.decode(allowance.value));
      case PeriodicAllowance.typeUrl: {
        const periodic = PeriodicAllowance.decode(allowance.value);
        const overall = await basic(periodic.basic);
        const perPeriod = periodic.periodSpendLimit.length
          ? await l.coins(periodic.periodSpendLimit)
          : 'no limit';
        return {
          limit: `${overall.limit} in total, ${perPeriod} per period`,
          expires: overall.expires,
        };
      }
      case AllowedMsgAllowance.typeUrl:
        return await allowanceLimit(
          l,
          AllowedMsgAllowance.decode(allowance.value).allowance,
          depth + 1,
        );
      default:
        return unknown;
    }
  } catch {
    return unknown;
  }
}

async function feeGrantParts(l: Lookups, msg: MsgGrantAllowance): Promise<Parts> {
  const grantee = l.who(msg.grantee);
  const { limit, expires } = await allowanceLimit(l, msg.allowance);
  return {
    level: 'dangerous',
    icon: 'grant',
    title: 'Pay fees for another address',
    hero: limit,
    sub: `for ${grantee}`,
    rows: [
      ['Grantee', safeText(msg.grantee, 80), 'mono'],
      ['Limit', limit],
      ['Expires', expires],
    ],
    danger: feeGrantDanger(grantee),
  };
}

/** The red box of a fee grant; `grantee` is display text. */
function feeGrantDanger(grantee: string): DangerNotice {
  return {
    title: `This lets ${grantee} spend your tokens on fees`,
    text: 'Fees they pay are taken from this address until the allowance runs out or expires.',
  };
}

/** Exec messages inside exec messages read before the rest is reported as unreadable. */
const MAX_EXEC_DEPTH = 2;
const MAX_EXEC_ROWS = 10;
const OWN_ACCOUNT = 'Your own account';
const UNKNOWN_ACCOUNT = 'An account the wallet cannot read';

/** Whose authority a message wrapped in an exec uses. */
type Authority = { kind: 'own' } | { kind: 'other'; address: string } | { kind: 'unknown' };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Two `bze1…` addresses of the same account; anything else is never the same. */
function sameAddress(a: string, b: string): boolean {
  const x = bzeAddressHash(a);
  const y = bzeAddressHash(b);
  return x !== null && y !== null && sameBytes(x, y);
}

/**
 * A wrapped message signed by `me` (the address signing the transaction) acts on that
 * address's own account: the chain needs no grant for it. Another signer is a granter whose
 * permission is used. Anything but exactly one valid `bze1…` signer cannot be read. A nested
 * exec at `depth` is read for its grantee only, and not at all past the depth limit.
 */
function authorityOf(me: string, msg: AnyMsg, depth: number): Authority {
  const unknown: Authority = { kind: 'unknown' };
  let signers: string[] | null;
  try {
    if (msg.typeUrl === MsgExec.typeUrl) {
      if (depth >= MAX_EXEC_DEPTH) return unknown;
      signers = [MsgExec.decode(msg.value).grantee];
    } else {
      signers = signersOf(msg);
    }
  } catch {
    return unknown;
  }
  const [signer] = signers ?? [];
  if (signers?.length !== 1 || signer === undefined) return unknown;
  const mine = bzeAddressHash(me);
  const theirs = bzeAddressHash(signer);
  if (mine === null || theirs === null) return unknown;
  return sameBytes(mine, theirs) ? { kind: 'own' } : { kind: 'other', address: signer };
}

function authorityWords(l: Lookups, a: Authority): string {
  switch (a.kind) {
    case 'own':
      return 'from your own account';
    case 'other':
      return `on behalf of ${l.who(a.address)}`;
    case 'unknown':
      return 'from an account the wallet cannot read';
  }
}

function authorityRow(a: Authority): SummaryRow {
  switch (a.kind) {
    case 'own':
      return ['Runs from', OWN_ACCOUNT];
    case 'other':
      return ['Runs from', safeText(a.address, 80), 'mono'];
    case 'unknown':
      return ['Runs from', UNKNOWN_ACCOUNT];
  }
}

function execDanger(l: Lookups, authorities: Authority[]): DangerNotice {
  const [only] = authorities;
  if (authorities.length === 0) {
    return {
      title: 'This runs no messages',
      text: 'The request asks to act for other accounts but holds nothing to run. Continue only if you expect that.',
    };
  }
  if (authorities.length === 1 && only) {
    const text = {
      own: 'The message inside acts with your own address and its tokens, as if you signed it directly.',
      other: 'The message inside uses a permission another address gave yours.',
      unknown:
        'The wallet cannot tell whose account the message inside acts for: it may be your own.',
    }[only.kind];
    return {
      title: `This runs ${authorityWords(l, only)}`,
      text: `${text} Continue only if you expect that.`,
    };
  }
  if (authorities.some((a) => a.kind === 'own')) {
    return {
      title: 'Some of these run from your own account',
      text: 'Messages marked as running from your own account act with your own address and its tokens, as if you signed them directly. Continue only if you expect that.',
    };
  }
  if (authorities.some((a) => a.kind === 'unknown')) {
    return {
      title: 'Some of these may run from your own account',
      text: 'The wallet cannot tell whose account some of the messages inside act for: they may act with your own address and its tokens. Continue only if you expect that.',
    };
  }
  return {
    title: 'This runs messages on behalf of other accounts',
    text: 'The messages inside use permissions other addresses gave yours. Continue only if you expect that.',
  };
}

/** A wrapped message that could not be summarised. */
function unreadableParts(msg: AnyMsg): Parts {
  return { ...unknownParts(msg, `${safeText(msg.typeUrl)} (unreadable)`), level: 'dangerous' };
}

const NESTED_LABEL = /^Message (\d+(?:\.\d+)*)$/;

/** The rows of a nested exec, its `Message N` labels numbered under message `n`. */
function nestRows(rows: SummaryRow[], n: number): SummaryRow[] {
  return rows.map((r) => {
    const match = NESTED_LABEL.exec(r[0]);
    if (!match) return r;
    const label = `Message ${String(n)}.${match[1] ?? ''}`;
    return r.length === 3 ? [label, r[1], r[2]] : [label, r[1]];
  });
}

/** Types that wrap other messages: an authz exec, a DAO proposal and a DAO admin run. */
const WRAPPERS = new Set([MsgExec.typeUrl, MsgSubmitProposal.typeUrl, MsgAdminExecute.typeUrl]);

/**
 * Summaries of the messages a wrapper holds, at `depth + 1`. Only the first `MAX_EXEC_ROWS`
 * make node calls; a message that cannot be summarised is unreadable and dangerous.
 */
function wrappedParts(
  l: Lookups,
  msgs: AnyMsg[],
  depth: number,
  me: string | undefined,
): Promise<Parts[]> {
  return Promise.all(
    msgs.map(async (m, i) => {
      const lookups = i < MAX_EXEC_ROWS ? l : l.offline();
      try {
        return await partsOf(lookups, m, depth + 1, me);
      } catch {
        return unreadableParts(m);
      }
    }),
  );
}

/**
 * The rows of wrapped messages: a `Message N` line for each of the first `MAX_EXEC_ROWS`, the
 * row saying whose account it runs from, then its own rows; a count of the rest.
 */
function wrappedRows(
  msgs: AnyMsg[],
  inner: Parts[],
  accountRow: (i: number) => SummaryRow,
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  inner.slice(0, MAX_EXEC_ROWS).forEach((p, i) => {
    const own = WRAPPERS.has(msgs[i]?.typeUrl ?? '') ? nestRows(p.rows, i + 1) : p.rows;
    rows.push([`Message ${String(i + 1)}`, `${p.title} · ${p.hero} · ${p.sub}`]);
    rows.push(accountRow(i), ...own);
  });
  const more = msgs.length - MAX_EXEC_ROWS;
  if (more > 0) rows.push(['…', `${String(more)} more ${more === 1 ? 'message' : 'messages'}`]);
  return rows;
}

/**
 * `me` is the grantee of the outermost exec, which the request checks pin to the signing
 * address; nested execs compare their messages' signers with it too. Only the first
 * `MAX_EXEC_ROWS` messages are shown; the rest are summarised without node calls and warned
 * about when they need care.
 */
async function execParts(l: Lookups, msg: MsgExec, depth: number, me?: string): Promise<Parts> {
  const self = me ?? msg.grantee;
  const authorities = msg.msgs.map((m) => authorityOf(self, m, depth + 1));
  const inner = await wrappedParts(l, msg.msgs, depth, self);
  const nested: DangerNotice[] = [];
  // A hidden message needs a look unless it is an ordinary message of another readable account.
  let flagged = 0;
  for (let i = MAX_EXEC_ROWS; i < inner.length; i += 1) {
    if (inner[i]?.level !== 'normal' || authorities[i]?.kind !== 'other') flagged += 1;
  }
  if (flagged > 0) {
    nested.push({
      title:
        flagged === 1
          ? '1 message not shown here needs a closer look'
          : `${String(flagged)} messages not shown here need a closer look`,
      text: 'They run from your own account, need extra care, or cannot be read. Read them in the message details before you continue.',
    });
  }
  // Red boxes of the shown messages only. A wrapped message's own red box speaks of "your
  // address": kept only when that holds, and for nested execs, whose notices are worded for
  // the same signing address. One box per title.
  inner.slice(0, MAX_EXEC_ROWS).forEach((p, i) => {
    if (authorities[i]?.kind !== 'own' && msg.msgs[i]?.typeUrl !== MsgExec.typeUrl) return;
    for (const notice of [...(p.danger ? [p.danger] : []), ...(p.nested ?? [])]) {
      if (!nested.some((n) => n.title === notice.title)) nested.push(notice);
    }
  });
  const danger = execDanger(l, authorities);
  const [only] = inner;
  const [onlyAuthority] = authorities;
  if (msg.msgs.length === 1 && only && onlyAuthority) {
    return {
      level: 'dangerous',
      icon: only.icon,
      title: only.title,
      hero: only.hero,
      sub: `${only.sub} · ${authorityWords(l, onlyAuthority)}`,
      rows: [authorityRow(onlyAuthority), ...only.rows],
      danger,
      nested,
    };
  }
  const rows = wrappedRows(msg.msgs, inner, (i) =>
    authorityRow(authorities[i] ?? { kind: 'unknown' }),
  );
  const count = msg.msgs.length;
  return {
    level: 'dangerous',
    icon: 'grant',
    title: `${String(count)} ${count === 1 ? 'message' : 'messages'}`,
    hero: 'Run together',
    sub: `run by ${l.who(msg.grantee)}`,
    rows,
    danger,
    nested,
  };
}

const plural = (n: bigint, one: string, many = `${one}s`): string =>
  `${group(n.toString())} ${n === 1n ? one : many}`;

/** `30 days`, or the raw text when it is not a whole number. */
function daysText(raw: string): string {
  const n = toUint(raw);
  return n === null ? `${safeText(raw, 40)} days` : plural(n, 'day');
}

const baseUnits = (raw: string): string => `${safeText(raw, 40)} (base units)`;
const idText = (id: string): string => safeText(id, 40);

/** `a × b` for two unsigned integer strings, or null when either is not one. */
function product(a: string, b: string): bigint | null {
  const x = toUint(a);
  const y = toUint(b);
  return x === null || y === null ? null : x * y;
}

function governanceParts(typeUrl: string, action: string): Parts {
  return {
    level: 'normal',
    icon: 'settings',
    title: 'Governance',
    hero: action,
    sub: 'governance',
    rows: [
      ['Action', action],
      ['Type', safeText(typeUrl), 'mono'],
    ],
  };
}

// ---- tradebin: markets and pools ----

async function createMarketParts(l: Lookups, msg: MsgCreateMarket): Promise<Parts> {
  const pair = await l.pair(msg.base, msg.quote);
  return {
    level: 'normal',
    icon: 'create',
    title: 'Create market',
    hero: pair,
    sub: 'a new order book',
    rows: [
      ['Market', pair],
      ['Base', safeText(msg.base, 80), 'mono'],
      ['Quote', safeText(msg.quote, 80), 'mono'],
      await l.creationFee('market'),
    ],
  };
}

async function createPoolParts(l: Lookups, msg: MsgCreateLiquidityPool): Promise<Parts> {
  const [pair, base, quote, fee] = await Promise.all([
    l.pair(msg.base, msg.quote),
    l.money(msg.base, msg.initialBase),
    l.money(msg.quote, msg.initialQuote),
    l.creationFee('market'),
  ]);
  const valid = toUint(msg.initialBase) !== null && toUint(msg.initialQuote) !== null;
  return {
    level: valid ? 'normal' : 'unknown',
    icon: 'liquidity',
    title: 'Create pool',
    hero: pair,
    sub: `${base} + ${quote}`,
    rows: [
      ['Pool', pair],
      ['You add', `${base} + ${quote}`],
      ['Swap fee', safeText(msg.fee, 40)],
      ['Kind', msg.stable ? 'Stable' : 'Standard'],
      fee,
    ],
  };
}

// ---- rewards: staking rewards ----

function rewardIdParts(
  icon: MsgIcon,
  title: string,
  hero: string,
  sub: string,
  id: string,
  extra: SummaryRow[] = [],
): Parts {
  return {
    level: 'normal',
    icon,
    title,
    hero,
    sub,
    rows: [['Reward', idText(id), 'mono'], ...extra],
  };
}

function joinStakingParts(msg: MsgJoinStaking): Parts {
  // The staked token is the reward's, which the message does not name.
  return {
    ...rewardIdParts(
      'stake',
      'Stake',
      baseUnits(msg.amount),
      `in reward ${idText(msg.rewardId)}`,
      msg.rewardId,
      [['Amount', `${baseUnits(msg.amount)}, in the reward's staking token`]],
    ),
    level: toUint(msg.amount) === null ? 'unknown' : 'normal',
  };
}

async function createStakingRewardParts(l: Lookups, msg: MsgCreateStakingReward): Promise<Parts> {
  const total = product(msg.prizeAmount, msg.duration);
  const [perDay, totalText, staked, minStake] = await Promise.all([
    l.money(msg.prizeDenom, msg.prizeAmount),
    total === null ? Promise.resolve(null) : l.money(msg.prizeDenom, total),
    l.token(msg.stakingDenom),
    l.money(msg.stakingDenom, msg.minStake),
  ]);
  const days = daysText(msg.duration);
  return {
    level:
      total !== null && toUint(msg.minStake) !== null && toUint(msg.lock) !== null
        ? 'normal'
        : 'unknown',
    icon: 'rewards',
    title: 'Create staking reward',
    hero: totalText ?? perDay,
    sub: `over ${days}, for ${staked.symbol} stakers`,
    rows: [
      ['Prize per day', perDay],
      ['Duration', days],
      ['Staked token', staked.symbol],
      ['Minimum stake', minStake],
      ['Lock after unstaking', daysText(msg.lock)],
      ['You pay', `${totalText ?? 'Prize per day × duration'} + the chain's creation fee`],
    ],
  };
}

function updateStakingRewardParts(msg: MsgUpdateStakingReward): Parts {
  const days = daysText(msg.duration);
  return {
    ...rewardIdParts(
      'rewards',
      'Extend staking reward',
      `Reward ${idText(msg.rewardId)}`,
      `by ${days}`,
      msg.rewardId,
      [
        ['Extra days', days],
        ['Cost', `The reward's daily prize × ${days}`],
      ],
    ),
    level: toUint(msg.duration) === null ? 'unknown' : 'normal',
  };
}

function distributeStakingRewardsParts(msg: MsgDistributeStakingRewards): Parts {
  return {
    ...rewardIdParts(
      'rewards',
      'Top up staking reward',
      baseUnits(msg.amount),
      `reward ${idText(msg.rewardId)}`,
      msg.rewardId,
      [['Amount', `${baseUnits(msg.amount)}, in the reward's prize token`]],
    ),
    level: toUint(msg.amount) === null ? 'unknown' : 'normal',
  };
}

// ---- rewards: trading rewards ----

async function createTradingRewardParts(l: Lookups, msg: MsgCreateTradingReward): Promise<Parts> {
  const market = await l.market(msg.marketId);
  const pair = market ? await l.pair(market.base, market.quote) : safeText(msg.marketId);
  const total = product(msg.prizeAmount, msg.slots);
  const [perSlot, totalText] = await Promise.all([
    l.money(msg.prizeDenom, msg.prizeAmount),
    total === null ? Promise.resolve(null) : l.money(msg.prizeDenom, total),
  ]);
  const days = daysText(msg.duration);
  return {
    level: total !== null && toUint(msg.duration) !== null ? 'normal' : 'unknown',
    icon: 'rewards',
    title: 'Create trading reward',
    hero: totalText ?? perSlot,
    sub: `on ${pair} for ${days}`,
    rows: [
      market ? ['Market', pair] : ['Market', pair, 'mono'],
      ['Prize per winner', perSlot],
      ['Winners', safeText(msg.slots, 40)],
      ['Duration', days],
      ['You pay', `${totalText ?? 'Prize per winner × winners'} + the chain's creation fee`],
    ],
  };
}

// ---- rewards: holder (denom) rewards ----

async function holderParts(
  l: Lookups,
  icon: MsgIcon,
  title: string,
  denom: string,
  sub: string,
): Promise<Parts> {
  const symbol = (await l.token(denom)).symbol;
  return { level: 'normal', icon, title, hero: symbol, sub, rows: [['Token', symbol]] };
}

async function joinDenomRewardParts(l: Lookups, msg: MsgJoinDenomReward): Promise<Parts> {
  const amount = await l.money(msg.denom, msg.amount);
  return {
    level: toUint(msg.amount) === null ? 'unknown' : 'normal',
    icon: 'stake',
    title: 'Lock',
    hero: amount,
    sub: 'for holder rewards',
    rows: [['Amount', amount]],
  };
}

async function createScheduleParts(l: Lookups, msg: MsgCreateDenomRewardSchedule): Promise<Parts> {
  const total = product(msg.dailyAmount, msg.duration);
  const [holders, perDay, totalText] = await Promise.all([
    l.token(msg.denom),
    l.money(msg.prizeDenom, msg.dailyAmount),
    total === null ? Promise.resolve(null) : l.money(msg.prizeDenom, total),
  ]);
  const days = daysText(msg.duration);
  return {
    level: total === null ? 'unknown' : 'normal',
    icon: 'rewards',
    title: 'Schedule holder rewards',
    hero: totalText ?? perDay,
    sub: `${perDay} a day for ${days}, to ${holders.symbol} holders`,
    rows: [
      ['Holders of', holders.symbol],
      ['Per day', perDay],
      ['Duration', days],
      ['You pay', `${totalText ?? 'Per day × duration'} + the chain's creation fee`],
    ],
  };
}

async function updateScheduleParts(l: Lookups, msg: MsgUpdateDenomRewardSchedule): Promise<Parts> {
  const holders = (await l.token(msg.denom)).symbol;
  const days = daysText(msg.duration);
  return {
    level: toUint(msg.duration) === null ? 'unknown' : 'normal',
    icon: 'rewards',
    title: 'Extend holder rewards',
    hero: `Schedule ${idText(msg.scheduleId)}`,
    sub: `for ${holders} holders, by ${days}`,
    rows: [
      ['Holders of', holders],
      ['Schedule', idText(msg.scheduleId), 'mono'],
      ['Extra days', days],
      ['Cost', `The schedule's daily amount × ${days}`],
    ],
  };
}

async function distributeDenomRewardsParts(
  l: Lookups,
  msg: MsgDistributeDenomRewards,
): Promise<Parts> {
  const [holders, amount] = await Promise.all([
    l.token(msg.denom),
    l.money(msg.prizeDenom, msg.amount),
  ]);
  return {
    level: toUint(msg.amount) === null ? 'unknown' : 'normal',
    icon: 'rewards',
    title: 'Pay holder rewards',
    hero: amount,
    sub: `to ${holders.symbol} holders`,
    rows: [
      ['Holders of', holders.symbol],
      ['Amount', amount],
    ],
  };
}

// ---- tokenfactory ----

async function mintOrBurnParts(
  l: Lookups,
  raw: string,
  icon: MsgIcon,
  title: string,
  sub: string,
): Promise<Parts> {
  const coins = parseCoinString(raw);
  const amount = coins ? await l.coins(coins) : safeText(raw, 200);
  return {
    level: coins ? 'normal' : 'unknown',
    icon,
    title,
    hero: amount,
    sub,
    rows: [['Amount', amount]],
  };
}

async function changeAdminParts(l: Lookups, msg: MsgChangeAdmin): Promise<Parts> {
  const symbol = (await l.token(msg.denom)).symbol;
  if (msg.newAdmin === '') {
    // The chain reads an empty admin as giving the token up; a mintable token stops minting.
    return {
      level: 'normal',
      icon: 'admin',
      title: 'Give up admin',
      hero: symbol,
      sub: 'no one can mint it or change it after this',
      rows: [
        ['Token', symbol],
        ['New admin', 'None'],
      ],
    };
  }
  const who = l.who(msg.newAdmin);
  return {
    // The new admin controls the token, and nothing gives it back.
    level: 'dangerous',
    icon: 'admin',
    title: 'Hand over admin',
    hero: symbol,
    sub: `to ${who}`,
    rows: [
      ['Token', symbol],
      ['New admin', safeText(msg.newAdmin, 80), 'mono'],
    ],
    danger: {
      title: `This gives ${who} control of ${symbol}`,
      // Whether they can mint depends on the token: a handover never turns minting back on.
      text: `They can change ${symbol} and pass it on. You can't undo this.`,
    },
  };
}

async function setMetadataParts(l: Lookups, msg: MsgSetDenomMetadata): Promise<Parts> {
  const md = msg.metadata;
  const current = (await l.token(md.base)).symbol;
  const unit = md.denomUnits.find((u) => u.denom === md.display);
  const decimals = unit ? String(unit.exponent) : '?';
  const name = safeText(md.name, 60);
  const symbol = safeText(md.symbol, 40);
  return {
    level: unit ? 'normal' : 'unknown',
    icon: 'edit',
    title: 'Set token details',
    hero: current,
    sub: `${name}, ${symbol}, ${decimals} decimals`,
    rows: [
      ['Token', safeText(md.base, 80), 'mono'],
      ['Name', name],
      ['Symbol', symbol],
      ['Decimals', decimals],
      ['Description', safeText(md.description, 200)],
    ],
  };
}

async function setBrandingParts(l: Lookups, msg: MsgSetDenomBranding): Promise<Parts> {
  const symbol = (await l.token(msg.denom)).symbol;
  const rows: SummaryRow[] = [['Token', symbol]];
  if (msg.branding?.font) rows.push(['Font', safeText(msg.branding.font, 60)]);
  return {
    level: 'normal',
    icon: 'edit',
    title: 'Set brand colours',
    hero: symbol,
    sub: 'colours and font of the token',
    rows,
  };
}

// ---- tokenfactory: token config ----

/** A ratio as a percentage: `0.05` → `5%`; the raw text when it is not a plain decimal. */
function percentText(ratio: string): string {
  if (!isDecimal(ratio)) return safeText(ratio, 40);
  const [whole = '0', fraction = ''] = ratio.split('.');
  const digits = `${whole}${fraction.padEnd(2, '0')}`;
  const units = digits.slice(0, whole.length + 2).replace(/^0+(?=\d)/, '');
  const rest = fraction.slice(2).replace(/0+$/, '');
  return `${units}${rest === '' ? '' : `.${rest}`}%`;
}

async function setDenomConfigParts(l: Lookups, msg: factory.MsgSetDenomConfig): Promise<Parts> {
  const symbol = (await l.token(msg.denom)).symbol;
  const transfer = percentText(msg.transferFee);
  const surcharge = percentText(msg.gasSurcharge);
  const receiver: SummaryRow =
    msg.communityPool === ''
      ? ['Fees go to', 'No one']
      : ['Fees go to', safeText(msg.communityPool, 80), 'mono'];
  return {
    level: isDecimal(msg.transferFee) && isDecimal(msg.gasSurcharge) ? 'normal' : 'unknown',
    icon: 'settings',
    title: 'Set token fees',
    hero: symbol,
    sub: `${transfer} transfer fee, ${surcharge} gas surcharge`,
    rows: [['Token', symbol], ['Transfer fee', transfer], ['Gas surcharge', surcharge], receiver],
  };
}

async function disableMintingParts(l: Lookups, msg: factory.MsgDisableMinting): Promise<Parts> {
  const symbol = (await l.token(msg.denom)).symbol;
  return {
    level: 'dangerous',
    icon: 'admin',
    title: 'Stop minting',
    hero: symbol,
    sub: 'for good',
    rows: [['Token', symbol]],
    danger: {
      title: `No one can mint ${symbol} again`,
      text: "This turns minting off for good, for you and any later admin. You can't undo this.",
    },
  };
}

// ---- DAOs ----

const daoText = (id: bigint): string => `DAO #${id.toString()}`;
const proposalText = (id: bigint): string => `proposal #${id.toString()}`;

const DAO_VOTES: Partial<Record<DaoVoteOption, string>> = {
  [DaoVoteOption.YES]: 'Yes',
  [DaoVoteOption.NO]: 'No',
  [DaoVoteOption.ABSTAIN]: 'Abstain',
};

/** A duration in whole days, hours, minutes or seconds. */
function periodText(d: Duration | undefined): string {
  if (!d) return 'None';
  const s = d.seconds;
  for (const [unit, name] of [
    [86_400n, 'day'],
    [3_600n, 'hour'],
    [60n, 'minute'],
  ] as const) {
    if (s > 0n && s % unit === 0n) return plural(s / unit, name);
  }
  return plural(s, 'second');
}

const DESTINATIONS: Partial<Record<FundsDestination, string>> = {
  [FundsDestination.BURN]: 'burned',
  [FundsDestination.TREASURY]: "kept in the DAO's account",
};

const REFUNDS: Partial<Record<DepositRefundPolicy, string>> = {
  [DepositRefundPolicy.ALWAYS]: 'always given back',
  [DepositRefundPolicy.ONLY_PASSED]: 'given back only when the proposal passes',
  [DepositRefundPolicy.NEVER]: 'never given back',
};

/** A coin of a DAO config; `null` when it is absent or zero. */
async function daoCoin(l: Lookups, coin: Coin | undefined): Promise<string | null> {
  if (!coin || coin.denom === '' || coin.amount === '' || coin.amount === '0') return null;
  return l.money(coin.denom, coin.amount);
}

/** The voting rules of a DAO config. */
async function daoConfigRows(l: Lookups, c: DaoConfig): Promise<SummaryRow[]> {
  const [cost, deposit] = await Promise.all([
    daoCoin(l, c.proposalCost),
    daoCoin(l, c.proposalDeposit),
  ]);
  const rows: SummaryRow[] = [
    ['Quorum', percentText(c.minQuorum)],
    ['Passes above', `${percentText(c.threshold)} yes`],
    ['Voting period', periodText(c.votingPeriod)],
    [
      'Expedited voting',
      c.allowExpedite
        ? `${periodText(c.expeditedPeriod)}, quorum ${percentText(c.expediteQuorum)}, passes above ${percentText(c.expediteThreshold)} yes`
        : 'Off',
    ],
    ['Who can propose', c.openSubmission ? 'Anyone' : 'Voters only'],
    [
      'Proposal cost',
      cost === null ? 'None' : `${cost}, ${DESTINATIONS[c.costDestination] ?? 'unknown'}`,
    ],
  ];
  if (deposit === null) {
    rows.push(['Proposal deposit', 'None']);
  } else {
    const refund = REFUNDS[c.depositRefundPolicy] ?? 'unknown';
    const kept = DESTINATIONS[c.keptDepositDestination] ?? 'unknown';
    rows.push(['Proposal deposit', `${deposit}, ${refund}; when kept, ${kept}`]);
  }
  return rows;
}

/** Whether every enum of a DAO config has a value the wallet knows. */
const knownConfig = (c: DaoConfig): boolean =>
  DESTINATIONS[c.costDestination] !== undefined &&
  DESTINATIONS[c.keptDepositDestination] !== undefined &&
  REFUNDS[c.depositRefundPolicy] !== undefined;

/** A list of addresses: the first `MAX_EXEC_ROWS`, then how many more. */
function addressRows(label: string, addresses: string[]): SummaryRow[] {
  const rows = addresses
    .slice(0, MAX_EXEC_ROWS)
    .map((a): SummaryRow => [label, safeText(a, 80), 'mono']);
  const more = addresses.length - MAX_EXEC_ROWS;
  if (more > 0) rows.push(['…', `${String(more)} more`]);
  return rows;
}

function electorateRows(e: StakeElectorate | undefined): SummaryRow[] {
  const sources = (e?.srIds ?? []).map((id) => `staking reward ${idText(id)}`);
  const drDenom = e?.drDenom ?? '';
  if (drDenom !== '') sources.push(`holder reward of ${safeText(drDenom, 80)}`);
  if (sources.length === 0) return [['Voters', 'No one']];
  return [['Voters', `Stakers of ${sources.slice(0, MAX_EXEC_ROWS).join(', ')}`]];
}

async function createDaoParts(l: Lookups, msg: MsgCreateDao): Promise<Parts> {
  const name = safeText(msg.name, 60);
  const stake = msg.type === DaoType.DAO_TYPE_STAKE;
  const known = stake || msg.type === DaoType.DAO_TYPE_STATIC_LIST;
  const voters = stake
    ? electorateRows(msg.electorate)
    : [
        ['Members', plural(BigInt(msg.members.length), 'member')] as SummaryRow,
        ...addressRows('Member', msg.members),
      ];
  const admin: SummaryRow =
    msg.admin === ''
      ? ['Admin', 'None: its voters run it']
      : ['Admin', safeText(msg.admin, 80), 'mono'];
  return {
    level: known && knownConfig(msg.config) ? 'normal' : 'unknown',
    icon: 'create',
    title: 'Create DAO',
    hero: name,
    sub: stake ? 'voted by stakers' : `voted by ${plural(BigInt(msg.members.length), 'member')}`,
    rows: [
      ['Name', name],
      ['Description', safeText(msg.description, 200)],
      admin,
      ...voters,
      ...(await daoConfigRows(l, msg.config)),
      ['Creation fee', "The chain's DAO creation fee"],
    ],
  };
}

/** A DAO's messages that its account signs, each read as an inner message. */
async function daoWrapperParts(
  l: Lookups,
  msgs: AnyMsg[],
  depth: number,
  runsAs: string,
): Promise<{ rows: SummaryRow[]; unreadable: number; level: RiskLevel }> {
  // The DAO signs these, never the wallet: a nested exec is read for its own grantee.
  const inner = await wrappedParts(l, msgs, depth, '');
  const rows = wrappedRows(msgs, inner, () => ['Runs as', runsAs]);
  return {
    rows,
    unreadable: inner.filter((p) => p.unreadable).length,
    level: riskiest(inner.map((p) => p.level)),
  };
}

const CARE_NOTICE: DangerNotice = {
  title: 'A message inside needs extra care',
  text: 'If the proposal passes, the DAO runs a message the wallet marks as dangerous, such as a change to who decides in it. Read the messages before you continue.',
};

function unreadableNotice(count: number): DangerNotice {
  return {
    title:
      count === 1
        ? 'The wallet cannot read 1 message inside'
        : `The wallet cannot read ${String(count)} messages inside`,
    text: 'It cannot tell what they do with the DAO and its funds. Continue only if you expect that.',
  };
}

async function submitProposalParts(
  l: Lookups,
  msg: MsgSubmitProposal,
  depth: number,
): Promise<Parts> {
  const dao = daoText(msg.daoId);
  const count = msg.msgs.length;
  const { rows, unreadable, level } = await daoWrapperParts(
    l,
    msg.msgs,
    depth,
    `${dao}, if it passes`,
  );
  // The proposal is as risky as the riskiest message it would run, with one notice of its own:
  // the notices of the messages inside speak of the wallet's own address, not the DAO's.
  const danger =
    unreadable > 0 ? unreadableNotice(unreadable) : level === 'dangerous' ? CARE_NOTICE : null;
  const title = safeText(msg.title, 80);
  return {
    level: unreadable > 0 ? 'dangerous' : level,
    icon: 'vote',
    title: 'DAO proposal',
    hero: title,
    sub: `to ${dao} · ${count === 0 ? 'no messages' : plural(BigInt(count), 'message')}`,
    rows: [
      ['DAO', dao],
      ['Title', title],
      ['Summary', safeText(msg.summary, 200)],
      ['Voting', msg.expedited ? 'Expedited' : 'Normal'],
      // Set by the DAO's config, which the request does not carry.
      ['You pay', "The DAO's proposal cost and deposit, if it has them"],
      ...rows,
    ],
    ...(danger ? { danger } : {}),
  };
}

async function adminExecuteParts(l: Lookups, msg: MsgAdminExecute, depth: number): Promise<Parts> {
  const dao = daoText(msg.daoId);
  const count = msg.msgs.length;
  const { rows, unreadable } = await daoWrapperParts(l, msg.msgs, depth, dao);
  return {
    level: 'dangerous',
    icon: 'grant',
    title: 'Run as DAO admin',
    hero: count === 0 ? 'No messages' : plural(BigInt(count), 'message'),
    sub: `as ${dao}`,
    rows: [['DAO', dao], ...rows],
    danger: {
      title: `This acts as ${dao} at once`,
      text: "As its admin, you run these messages with the DAO's account and its funds, without a vote. Continue only if you expect that.",
    },
    ...(unreadable > 0 ? { nested: [unreadableNotice(unreadable)] } : {}),
  };
}

function daoVoteParts(msg: DaoMsgVote): Parts {
  const option = DAO_VOTES[msg.option];
  const proposal = proposalText(msg.proposalId);
  return {
    level: option ? 'normal' : 'unknown',
    icon: 'vote',
    title: 'DAO vote',
    hero: option ?? 'Unknown vote',
    sub: `on DAO ${proposal}`,
    rows: [
      ['Proposal', `#${msg.proposalId.toString()}`],
      ['Vote', option ?? 'Unknown vote'],
    ],
  };
}

function proposalActionParts(icon: MsgIcon, title: string, proposalId: bigint, sub: string): Parts {
  return {
    level: 'normal',
    icon,
    title,
    hero: `Proposal #${proposalId.toString()}`,
    sub,
    rows: [['Proposal', `#${proposalId.toString()}`]],
  };
}

function nominateAdminParts(l: Lookups, msg: MsgNominateAdmin): Parts {
  const dao = daoText(msg.daoId);
  if (msg.nominee === '') {
    return {
      level: 'dangerous',
      icon: 'admin',
      title: 'Give up DAO admin',
      hero: dao,
      sub: 'its voters run it from now on',
      rows: [
        ['DAO', dao],
        ['New admin', 'None: its voters'],
      ],
      danger: {
        title: `This hands ${dao} to its voters`,
        text: "It takes effect at once and the DAO has no admin after this. You can't undo this.",
      },
    };
  }
  const who = l.who(msg.nominee);
  return {
    level: 'dangerous',
    icon: 'admin',
    title: 'Nominate DAO admin',
    hero: dao,
    sub: `to ${who}`,
    rows: [
      ['DAO', dao],
      ['Nominee', safeText(msg.nominee, 80), 'mono'],
    ],
    danger: {
      title: `This offers ${who} control of ${dao}`,
      text: 'Once they accept, they run the DAO and its funds. You can withdraw the offer until then.',
    },
  };
}

function daoIdParts(icon: MsgIcon, title: string, daoId: bigint, sub: string): Parts {
  const dao = daoText(daoId);
  return { level: 'normal', icon, title, hero: dao, sub, rows: [['DAO', dao]] };
}

/** A change to a DAO's voters or rules: dangerous, it decides who controls the DAO. */
function daoChangeDanger(dao: string): DangerNotice {
  return {
    title: `This changes who decides in ${dao}`,
    text: 'It changes who votes or how votes pass. Open proposals keep the rules they started with. Continue only if you expect that.',
  };
}

async function updateDaoConfigParts(l: Lookups, msg: MsgUpdateDaoConfig): Promise<Parts> {
  const dao = daoText(msg.daoId);
  return {
    level: 'dangerous',
    icon: 'settings',
    title: 'Change DAO rules',
    hero: dao,
    sub: 'replaces its voting rules',
    rows: [['DAO', dao], ...(await daoConfigRows(l, msg.config))],
    danger: daoChangeDanger(dao),
  };
}

function updateMetadataParts(msg: MsgUpdateMetadata): Parts {
  const dao = daoText(msg.daoId);
  const name = safeText(msg.name, 60);
  return {
    level: 'normal',
    icon: 'edit',
    title: 'Rename DAO',
    hero: dao,
    sub: `to ${name}`,
    rows: [
      ['DAO', dao],
      ['Name', name],
      ['Description', safeText(msg.description, 200)],
    ],
  };
}

function updateElectorateParts(msg: MsgUpdateElectorate): Parts {
  const dao = daoText(msg.daoId);
  return {
    level: 'dangerous',
    icon: 'settings',
    title: 'Change DAO voters',
    hero: dao,
    sub: 'replaces the rewards whose stakers vote',
    rows: [['DAO', dao], ...electorateRows(msg.electorate)],
    danger: daoChangeDanger(dao),
  };
}

function updateMembersParts(msg: MsgUpdateMembers): Parts {
  const dao = daoText(msg.daoId);
  const added = plural(BigInt(msg.add.length), 'member');
  const removed = plural(BigInt(msg.remove.length), 'member');
  return {
    level: 'dangerous',
    icon: 'settings',
    title: 'Change DAO members',
    hero: dao,
    sub: `adds ${added}, removes ${removed}`,
    rows: [['DAO', dao], ...addressRows('Add', msg.add), ...addressRows('Remove', msg.remove)],
    danger: daoChangeDanger(dao),
  };
}

// ---- guardian ----

const GUARDIAN_DANGER: DangerNotice = {
  title: 'Only a chain guardian can send this',
  text: "It is an emergency action of the chain's guardians, and the chain refuses it from any other address. Continue only if you are one and expect it.",
};

function guardianParts(hero: string, sub: string, rows: SummaryRow[]): Parts {
  return {
    level: 'dangerous',
    icon: 'settings',
    title: 'Guardian action',
    hero,
    sub,
    rows: [['Action', hero], ...rows],
    danger: GUARDIAN_DANGER,
  };
}

/** A list of short texts in rows: the first `MAX_EXEC_ROWS`, then how many more. */
function listRows(label: string, items: string[]): SummaryRow[] {
  const rows = items
    .slice(0, MAX_EXEC_ROWS)
    .map((t): SummaryRow => [label, safeText(t, 120), 'mono']);
  const more = items.length - MAX_EXEC_ROWS;
  if (more > 0) rows.push(['…', `${String(more)} more`]);
  return rows;
}

function guardianMsgParts(msg: AnyMsg): Parts | null {
  switch (msg.typeUrl) {
    case guardian.MsgTightenRateLimit.typeUrl: {
      const m = guardian.MsgTightenRateLimit.decode(msg.value);
      return guardianParts('Tighten an IBC rate limit', `of ${safeText(m.denom, 80)}`, [
        ['Token', safeText(m.denom, 80), 'mono'],
        ['Channel', safeText(m.channelId, 40), 'mono'],
        ['Send limit', `${safeText(m.maxPercentSend, 40)}%`],
        ['Receive limit', `${safeText(m.maxPercentRecv, 40)}%`],
      ]);
    }
    case guardian.MsgBlockDenom.typeUrl: {
      const m = guardian.MsgBlockDenom.decode(msg.value);
      return guardianParts('Block a token over IBC', safeText(m.denom, 80), [
        ['Token', safeText(m.denom, 80), 'mono'],
      ]);
    }
    case guardian.MsgDisableMessages.typeUrl: {
      const m = guardian.MsgDisableMessages.decode(msg.value);
      return guardianParts(
        'Turn off message types',
        plural(BigInt(m.msgTypeUrls.length), 'type'),
        listRows('Type', m.msgTypeUrls),
      );
    }
    case guardian.MsgHaltTradingDenoms.typeUrl: {
      const m = guardian.MsgHaltTradingDenoms.decode(msg.value);
      return guardianParts(
        'Halt trading of tokens',
        plural(BigInt(m.denoms.length), 'token'),
        listRows('Token', m.denoms),
      );
    }
    case guardian.MsgHaltChain.typeUrl: {
      const m = guardian.MsgHaltChain.decode(msg.value);
      return guardianParts('Halt the chain', 'stops the chain', [
        ['Reason', safeText(m.reason, 200)],
      ]);
    }
    case guardian.MsgPauseAutomation.typeUrl:
      return guardianParts('Pause automatic chain jobs', 'until governance resumes them', []);
    case guardian.MsgCloseChannel.typeUrl: {
      const m = guardian.MsgCloseChannel.decode(msg.value);
      return guardianParts('Close an IBC channel', safeText(m.channelId, 40), [
        ['Channel', safeText(m.channelId, 40), 'mono'],
      ]);
    }
    default:
      return null;
  }
}

// ---- burner ----

async function startRaffleParts(l: Lookups, msg: MsgStartRaffle): Promise<Parts> {
  const [token, pot, price] = await Promise.all([
    l.token(msg.denom),
    l.money(msg.denom, msg.pot),
    l.money(msg.denom, msg.ticketPrice),
  ]);
  const valid =
    toUint(msg.pot) !== null && toUint(msg.ticketPrice) !== null && toUint(msg.duration) !== null;
  return {
    level: valid ? 'normal' : 'unknown',
    icon: 'raffle',
    title: 'Start raffle',
    hero: `${token.symbol} raffle`,
    sub: `ticket price ${price}`,
    rows: [
      ['Pot you add', pot],
      ['Ticket price', price],
      ['Duration', daysText(msg.duration)],
      ['Chances', safeText(msg.chances, 40)],
      ['Ratio', safeText(msg.ratio, 40)],
    ],
  };
}

// ---- cointrunk ----

function addArticleParts(msg: MsgAddArticle): Parts {
  const title = safeText(msg.title, 80);
  return {
    level: 'normal',
    icon: 'article',
    title: 'Publish article',
    hero: title,
    sub: safeText(msg.url, 80),
    rows: [
      ['Title', safeText(msg.title, 200)],
      ['Link', safeText(msg.url, 200), 'mono'],
      ...(msg.picture ? ([['Picture', safeText(msg.picture, 200), 'mono']] as SummaryRow[]) : []),
    ],
  };
}

async function payRespectParts(l: Lookups, msg: MsgPayPublisherRespect): Promise<Parts> {
  const coins = parseCoinString(msg.amount);
  const amount = coins ? await l.coins(coins) : safeText(msg.amount, 200);
  return {
    level: coins?.length === 1 ? 'normal' : 'unknown',
    icon: 'send',
    title: 'Pay respect',
    hero: amount,
    sub: `to ${l.who(msg.address)}`,
    rows: [
      ['Publisher', safeText(msg.address, 80), 'mono'],
      ['Amount', amount],
    ],
  };
}

// ---- cosmos and ibc ----

/**
 * Most recipients a multi-send review lists. Every one is listed up to here, so an airdrop reads
 * in full; past it the list is cut short, says so and needs the user's tick.
 */
const MAX_MULTISEND_RECIPIENTS = 1000;

async function multiSendParts(l: Lookups, msg: MsgMultiSend): Promise<Parts> {
  const totals = new Map<string, bigint>();
  let valid = msg.outputs.length > 0;
  for (const out of msg.outputs) {
    for (const c of out.coins) {
      const n = toUint(c.amount);
      if (n === null) valid = false;
      else totals.set(c.denom, (totals.get(c.denom) ?? 0n) + n);
    }
  }
  const [only] = [...totals];
  const hero =
    totals.size === 1 && only
      ? await l.money(only[0], only[1])
      : totals.size === 0
        ? 'No tokens'
        : `${String(totals.size)} tokens`;
  const [single] = msg.outputs;
  if (msg.outputs.length === 1 && single) {
    // One output reads like a send.
    const rows: SummaryRow[] = [['To', safeText(single.address, 80), 'mono']];
    for (const coin of single.coins) rows.push(['Amount', await l.money(coin.denom, coin.amount)]);
    return {
      level: valid ? 'normal' : 'unknown',
      icon: 'send',
      title: 'Send',
      hero,
      sub: `to ${l.who(single.address)}`,
      rows,
    };
  }
  const rows: SummaryRow[] = [];
  for (const [denom, amount] of totals) rows.push(['Total', await l.money(denom, amount)]);
  for (const out of msg.outputs.slice(0, MAX_MULTISEND_RECIPIENTS)) {
    const name = l.ctx.addressBook(out.address);
    rows.push([name ? safeText(name, 40) : 'To', safeText(out.address, 80), 'mono']);
    rows.push(['Amount', (await coinsText(l, out.coins)) ?? 'Unreadable amount']);
  }
  const count = msg.outputs.length;
  const cut = count > MAX_MULTISEND_RECIPIENTS;
  if (cut) {
    rows.push([
      '…',
      `Showing ${group(String(MAX_MULTISEND_RECIPIENTS))} of ${group(String(count))} recipients`,
    ]);
  }
  const level: RiskLevel = cut ? 'dangerous' : valid ? 'normal' : 'unknown';
  return {
    level,
    icon: 'send',
    title: 'Send',
    hero,
    sub: `to ${plural(BigInt(count), 'address', 'addresses')}`,
    rows,
    ...(cut
      ? {
          danger: {
            title: 'Not every recipient is shown here',
            text: `This sends to ${group(String(count))} addresses and only the first ${group(String(MAX_MULTISEND_RECIPIENTS))} are listed. The totals count all of them, but the other recipients are only in the raw message. Reject this request unless you expect them.`,
          },
        }
      : {}),
  };
}

/** A coin field of a staking or IBC message, which may be absent. */
async function coinText(l: Lookups, coin: Coin | undefined): Promise<string | null> {
  if (!coin || toUint(coin.amount) === null || coin.denom === '') return null;
  return l.money(coin.denom, coin.amount);
}

async function stakingParts(
  l: Lookups,
  title: string,
  coin: Coin | undefined,
  sub: string,
  rows: SummaryRow[],
): Promise<Parts> {
  const amount = await coinText(l, coin);
  return {
    level: amount === null ? 'unknown' : 'normal',
    icon: 'stake',
    title,
    hero: amount ?? 'Unreadable amount',
    sub,
    rows: [...rows, ['Amount', amount ?? 'Unreadable amount']],
  };
}

function setWithdrawAddressParts(l: Lookups, msg: MsgSetWithdrawAddress): Parts {
  const address = safeText(msg.withdrawAddress, 80);
  const own =
    sameAddress(msg.withdrawAddress, msg.delegatorAddress) || l.isOwn(msg.withdrawAddress);
  return {
    level: own ? 'normal' : 'dangerous',
    icon: 'rewards',
    title: 'Change rewards address',
    hero: address,
    sub: 'Your future staking rewards go there',
    rows: [['Rewards address', address, 'mono']],
    ...(own
      ? {}
      : {
          danger: {
            title: `Your future staking rewards go to ${l.who(msg.withdrawAddress)}`,
            text: 'This is not an address of this wallet. From now on, the staking rewards of this address are paid there, also when you later stake, unstake or move stake, until you change it back. Continue only if you expect that.',
          },
        }),
  };
}

function withdrawRewardParts(l: Lookups, msg: MsgWithdrawDelegatorReward): Parts {
  return {
    level: 'normal',
    icon: 'rewards',
    title: 'Claim staking rewards',
    hero: 'Your rewards',
    sub: `from ${l.who(msg.validatorAddress)}`,
    rows: [['Validator', safeText(msg.validatorAddress, 80), 'mono']],
  };
}

/** Coins as text; `null` when one has no denom or an amount that is not a plain integer. */
async function coinsText(l: Lookups, coins: Coin[]): Promise<string | null> {
  if (coins.some((c) => c.denom === '' || toUint(c.amount) === null)) return null;
  return coins.length === 0 ? 'No tokens' : l.coins(coins);
}

/** Unix seconds as a date, `Unknown` when no date can hold them. */
const unixTime = (seconds: bigint): string => expiry(new Date(Number(seconds) * 1000));

/** Every period's coins added up per denom, or `null` when one cannot be read. */
function periodTotal(periods: Period[]): Coin[] | null {
  const sums = new Map<string, bigint>();
  for (const period of periods) {
    for (const coin of period.amount) {
      const value = toUint(coin.amount);
      if (value === null || coin.denom === '') return null;
      sums.set(coin.denom, (sums.get(coin.denom) ?? 0n) + value);
    }
  }
  return [...sums].map(([denom, amount]) => ({ denom, amount: amount.toString() }));
}

/** A new vesting account for another address: the coins leave the signer's for good. */
async function vestingParts(
  l: Lookups,
  title: string,
  to: string,
  coins: Coin[] | null,
  rows: SummaryRow[],
): Promise<Parts> {
  const amount = (coins === null ? null : await coinsText(l, coins)) ?? 'Unreadable amount';
  const who = l.who(to);
  return {
    level: 'dangerous',
    icon: 'send',
    title,
    hero: amount,
    sub: `to ${who}`,
    rows: [['To', safeText(to, 80), 'mono'], ['Amount', amount], ...rows],
    danger: {
      title: `This sends ${amount} to ${who}`,
      text: "The tokens leave your address for a new account that the other address owns. You can't undo this.",
    },
  };
}

function createVestingParts(l: Lookups, msg: MsgCreateVestingAccount): Promise<Parts> {
  return vestingParts(l, 'Create vesting account', msg.toAddress, msg.amount, [
    ['Vesting ends', unixTime(msg.endTime)],
    ['Unlocks', msg.delayed ? 'All at the end' : 'Gradually until the end'],
  ]);
}

function permanentLockedParts(l: Lookups, msg: MsgCreatePermanentLockedAccount): Promise<Parts> {
  return vestingParts(l, 'Create locked account', msg.toAddress, msg.amount, [
    ['Unlocks', 'Never: the tokens can only be staked'],
  ]);
}

function periodicVestingParts(l: Lookups, msg: MsgCreatePeriodicVestingAccount): Promise<Parts> {
  const length = msg.vestingPeriods.reduce((sum, p) => sum + p.length, 0n);
  return vestingParts(l, 'Create vesting account', msg.toAddress, periodTotal(msg.vestingPeriods), [
    ['Vesting starts', unixTime(msg.startTime)],
    ['Vesting ends', unixTime(msg.startTime + length)],
    ['Periods', String(msg.vestingPeriods.length)],
  ]);
}

/** Coins the signer gives away to a pool, a validator's delegators or a proposal. */
async function givingParts(
  l: Lookups,
  icon: MsgIcon,
  title: string,
  coins: Coin[],
  sub: string,
  rows: SummaryRow[],
): Promise<Parts> {
  const amount = await coinsText(l, coins);
  return {
    level: amount === null ? 'unknown' : 'normal',
    icon,
    title,
    hero: amount ?? 'Unreadable amount',
    sub,
    rows: [...rows, ['Amount', amount ?? 'Unreadable amount']],
  };
}

/** Where an IBC transfer's memo sends the coins after the receiving chain. */
type Destination =
  | { kind: 'none' }
  | { kind: 'forward'; receiver: string }
  | { kind: 'unknown'; why: 'contract' | 'unreadable' };

/** Forward hops read before the rest counts as unreadable. */
const MAX_FORWARD_HOPS = 8;
const MAX_RECEIVER = 128;

/**
 * The one key of `obj` that is `name` in any letter case: `undefined` when there is none,
 * `null` when it is not exactly `name` or there are several. Some readers on the other chain
 * match keys without regard to case, so another spelling is not ignored.
 */
function onlyKey(obj: Record<string, unknown>, name: string): string | null | undefined {
  const keys = Object.keys(obj).filter((k) => foldKey(k) === name);
  if (keys.length === 0) return undefined;
  return keys.length === 1 && keys[0] === name ? name : null;
}

/**
 * A key in lower case, with the two letters outside ASCII that some readers match to an ASCII
 * one (the long s and the Kelvin sign) turned into that letter.
 */
const foldKey = (key: string): string =>
  key
    .replace(/\u017F/g, 's')
    .replace(/\u212A/g, 'k')
    .toLowerCase();

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Whether an object in the JSON text names a key twice, in any letter case. Parsers disagree on
 * which copy wins, so instructions holding one cannot be read for sure.
 */
function hasRepeatedKey(text: string): boolean {
  // One entry per open container: the keys of an object, null for an array.
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      const keys = stack[stack.length - 1];
      if (expectKey && keys) {
        let key: unknown;
        try {
          key = JSON.parse(text.slice(i, end + 1));
        } catch {
          return true;
        }
        if (typeof key !== 'string') return true;
        const folded = foldKey(key);
        if (keys.has(folded)) return true;
        keys.add(folded);
      }
      expectKey = false;
      i = end;
    } else if (c === '{') {
      stack.push(new Set());
      expectKey = true;
    } else if (c === '[') {
      stack.push(null);
      expectKey = false;
    } else if (c === '}' || c === ']') {
      stack.pop();
      expectKey = false;
    } else if (c === ',') {
      expectKey = Boolean(stack[stack.length - 1]);
    }
  }
  return false;
}

/** A receiver as an address is written: letters and digits only. */
const ADDRESS_LIKE = /^[A-Za-z0-9]+$/;

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads the forwarding and contract-call instructions of a memo. Anything it cannot read for
 * sure gives `unknown`: the final recipient is never guessed.
 */
function memoDestination(memo: string): Destination {
  const destination = readDestination(memo);
  return destination.kind !== 'none' && hasRepeatedKey(memo)
    ? { kind: 'unknown', why: 'unreadable' }
    : destination;
}

function readDestination(memo: string): Destination {
  const unreadable: Destination = { kind: 'unknown', why: 'unreadable' };
  let obj: Record<string, unknown> | null = parseObject(memo);
  if (obj === null) {
    // Not a JSON object, so not instructions: unless it looks like broken ones.
    return /"\s*(forward|wasm)\s*"/i.test(memo) ? unreadable : { kind: 'none' };
  }
  let receiver: string | null = null;
  for (let hop = 0; hop <= MAX_FORWARD_HOPS; hop += 1) {
    if (onlyKey(obj, 'wasm') !== undefined) return { kind: 'unknown', why: 'contract' };
    const forwardKey = onlyKey(obj, 'forward');
    if (forwardKey === undefined) {
      return receiver === null ? { kind: 'none' } : { kind: 'forward', receiver };
    }
    if (forwardKey === null || hop === MAX_FORWARD_HOPS) return unreadable;
    const forward: unknown = obj[forwardKey];
    if (!isPlainObject(forward)) return unreadable;
    const receiverKey = onlyKey(forward, 'receiver');
    const value = receiverKey ? forward[receiverKey] : undefined;
    if (
      typeof value !== 'string' ||
      value === '' ||
      value.length > MAX_RECEIVER ||
      !ADDRESS_LIKE.test(value)
    ) {
      return unreadable;
    }
    receiver = value;
    const nextKey = onlyKey(forward, 'next');
    if (nextKey === undefined) return { kind: 'forward', receiver };
    if (nextKey === null) return unreadable;
    const next: unknown = forward[nextKey];
    if (next === null) return { kind: 'forward', receiver };
    if (typeof next === 'string' && hasRepeatedKey(next)) return unreadable;
    const nextObj: unknown = typeof next === 'string' ? parseObject(next) : next;
    if (!isPlainObject(nextObj)) return unreadable;
    obj = nextObj;
  }
  return unreadable;
}

async function transferParts(l: Lookups, msg: MsgTransfer): Promise<Parts> {
  const amount = await coinText(l, msg.token);
  const channel = safeText(msg.sourceChannel, 40);
  const destination = memoDestination(msg.memo);
  const rows: SummaryRow[] = [];
  if (destination.kind === 'forward') {
    rows.push(['Final recipient', destination.receiver, 'mono']);
  } else if (destination.kind === 'unknown') {
    rows.push([
      'Final recipient',
      destination.why === 'contract'
        ? 'Unknown (contract call)'
        : 'Unknown (instructions the wallet cannot read)',
    ]);
  }
  rows.push(
    [destination.kind === 'none' ? 'To' : 'First receiver', safeText(msg.receiver, 120), 'mono'],
    ['Amount', amount ?? 'Unreadable amount'],
    ['Channel', channel, 'mono'],
  );
  // A memo can tell the other chain to forward the coins on: show it.
  const memo = memoText(msg.memo);
  if (memo !== null) rows.push(['Memo', memo]);
  const base = {
    icon: 'send' as const,
    title: 'Send',
    hero: amount ?? 'Unreadable amount',
    rows,
  };
  switch (destination.kind) {
    case 'none':
      return {
        ...base,
        level: amount === null ? 'unknown' : 'normal',
        sub: `to ${l.who(msg.receiver)} on another chain · ${channel}`,
      };
    case 'forward':
      return {
        ...base,
        level: 'dangerous',
        sub: `to ${destination.receiver} · forwarded on from another chain`,
        danger: {
          title: 'The tokens are sent on from the other chain',
          text: `The memo asks the receiving chain to forward them to ${destination.receiver}. Continue only if you expect that.`,
        },
      };
    case 'unknown':
      return {
        ...base,
        level: 'dangerous',
        sub:
          destination.why === 'contract'
            ? 'final recipient unknown · contract call on another chain'
            : 'final recipient unknown · instructions the wallet cannot read',
        danger: {
          title: 'The wallet cannot tell where the tokens end up',
          text:
            destination.why === 'contract'
              ? 'The memo asks the receiving chain to run a contract with them. Continue only if you expect that.'
              : 'The memo holds forwarding instructions the wallet cannot read. Continue only if you expect that.',
        },
      };
  }
}

/** `depth` and `me` are set for messages wrapped in an exec; see `execParts`. */
async function partsOf(l: Lookups, msg: AnyMsg, depth = 0, me?: string): Promise<Parts> {
  const action = GOVERNANCE_ONLY.get(msg.typeUrl);
  if (action !== undefined) return governanceParts(msg.typeUrl, action);
  try {
    switch (msg.typeUrl) {
      case MsgSend.typeUrl:
        return await sendParts(l, MsgSend.decode(msg.value));
      case MsgMultiSwap.typeUrl:
        return await swapParts(l, MsgMultiSwap.decode(msg.value));
      case MsgCreateOrder.typeUrl:
        return await createOrderParts(l, MsgCreateOrder.decode(msg.value));
      case MsgCancelOrder.typeUrl:
        return await cancelOrderParts(l, MsgCancelOrder.decode(msg.value));
      case MsgFillOrders.typeUrl:
        return await fillOrdersParts(l, MsgFillOrders.decode(msg.value));
      case MsgAddLiquidity.typeUrl:
        return await addLiquidityParts(l, MsgAddLiquidity.decode(msg.value));
      case MsgRemoveLiquidity.typeUrl:
        return await removeLiquidityParts(l, MsgRemoveLiquidity.decode(msg.value));
      case MsgFundBurner.typeUrl:
        return await burnParts(l, MsgFundBurner.decode(msg.value));
      case MsgJoinRaffle.typeUrl:
        return await raffleParts(l, MsgJoinRaffle.decode(msg.value));
      case MsgVote.typeUrl:
        return voteParts(MsgVote.decode(msg.value));
      case MsgGrant.typeUrl:
        return await grantParts(l, MsgGrant.decode(msg.value));
      case MsgGrantAllowance.typeUrl:
        return await feeGrantParts(l, MsgGrantAllowance.decode(msg.value));
      case MsgExec.typeUrl:
        // Past the limit the bytes are not decoded at all.
        if (depth >= MAX_EXEC_DEPTH)
          return { ...unknownParts(msg, 'Nested too deeply to read'), level: 'dangerous' };
        return await execParts(l, MsgExec.decode(msg.value), depth, me);
      case MsgCreateMarket.typeUrl:
        return await createMarketParts(l, MsgCreateMarket.decode(msg.value));
      case MsgCreateLiquidityPool.typeUrl:
        return await createPoolParts(l, MsgCreateLiquidityPool.decode(msg.value));
      case rewards.MsgJoinStaking.typeUrl:
        return joinStakingParts(rewards.MsgJoinStaking.decode(msg.value));
      case rewards.MsgExitStaking.typeUrl: {
        const { rewardId } = rewards.MsgExitStaking.decode(msg.value);
        return rewardIdParts(
          'stake',
          'Unstake',
          'Your stake',
          `from reward ${idText(rewardId)}`,
          rewardId,
        );
      }
      case rewards.MsgClaimStakingRewards.typeUrl: {
        const { rewardId } = rewards.MsgClaimStakingRewards.decode(msg.value);
        return rewardIdParts(
          'rewards',
          'Claim rewards',
          'Your rewards',
          `from reward ${idText(rewardId)}`,
          rewardId,
        );
      }
      case rewards.MsgCreateStakingReward.typeUrl:
        return await createStakingRewardParts(l, rewards.MsgCreateStakingReward.decode(msg.value));
      case rewards.MsgUpdateStakingReward.typeUrl:
        return updateStakingRewardParts(rewards.MsgUpdateStakingReward.decode(msg.value));
      case rewards.MsgDeleteStakingReward.typeUrl: {
        const { rewardId } = rewards.MsgDeleteStakingReward.decode(msg.value);
        return rewardIdParts(
          'rewards',
          'Delete staking reward',
          `Reward ${idText(rewardId)}`,
          'a staking reward you created',
          rewardId,
        );
      }
      case rewards.MsgDistributeStakingRewards.typeUrl:
        return distributeStakingRewardsParts(rewards.MsgDistributeStakingRewards.decode(msg.value));
      case rewards.MsgCreateTradingReward.typeUrl:
        return await createTradingRewardParts(l, rewards.MsgCreateTradingReward.decode(msg.value));
      case rewards.MsgActivateTradingReward.typeUrl: {
        const { rewardId } = rewards.MsgActivateTradingReward.decode(msg.value);
        return rewardIdParts(
          'rewards',
          'Activate trading reward',
          `Reward ${idText(rewardId)}`,
          'starts the trading reward',
          rewardId,
        );
      }
      case rewards.MsgCreateDenomReward.typeUrl: {
        const { denom } = rewards.MsgCreateDenomReward.decode(msg.value);
        return await holderParts(
          l,
          'rewards',
          'Create holder reward',
          denom,
          'rewards for holders who lock it',
        );
      }
      case rewards.MsgJoinDenomReward.typeUrl:
        return await joinDenomRewardParts(l, rewards.MsgJoinDenomReward.decode(msg.value));
      case rewards.MsgExitDenomReward.typeUrl: {
        const { denom } = rewards.MsgExitDenomReward.decode(msg.value);
        return await holderParts(l, 'stake', 'Unlock', denom, 'from holder rewards');
      }
      case rewards.MsgClaimDenomRewards.typeUrl: {
        const { denom } = rewards.MsgClaimDenomRewards.decode(msg.value);
        return await holderParts(
          l,
          'rewards',
          'Claim holder rewards',
          denom,
          'your rewards for holding it',
        );
      }
      case rewards.MsgCreateDenomRewardSchedule.typeUrl:
        return await createScheduleParts(l, rewards.MsgCreateDenomRewardSchedule.decode(msg.value));
      case rewards.MsgUpdateDenomRewardSchedule.typeUrl:
        return await updateScheduleParts(l, rewards.MsgUpdateDenomRewardSchedule.decode(msg.value));
      case rewards.MsgDistributeDenomRewards.typeUrl:
        return await distributeDenomRewardsParts(
          l,
          rewards.MsgDistributeDenomRewards.decode(msg.value),
        );
      case factory.MsgCreateDenom.typeUrl: {
        const subdenom = safeText(factory.MsgCreateDenom.decode(msg.value).subdenom, 60);
        return {
          level: 'normal',
          icon: 'create',
          title: 'Create token',
          hero: subdenom,
          sub: 'you become its admin',
          rows: [['Subdenom', subdenom, 'mono'], await l.creationFee('token')],
        };
      }
      case factory.MsgMint.typeUrl:
        return await mintOrBurnParts(
          l,
          factory.MsgMint.decode(msg.value).coins,
          'create',
          'Mint',
          'new tokens, as token admin',
        );
      case factory.MsgBurn.typeUrl:
        return await mintOrBurnParts(
          l,
          factory.MsgBurn.decode(msg.value).coins,
          'burn',
          'Burn',
          'as token admin',
        );
      case factory.MsgChangeAdmin.typeUrl:
        return await changeAdminParts(l, factory.MsgChangeAdmin.decode(msg.value));
      case factory.MsgSetDenomMetadata.typeUrl:
        return await setMetadataParts(l, factory.MsgSetDenomMetadata.decode(msg.value));
      case factory.MsgSetDenomBranding.typeUrl:
        return await setBrandingParts(l, factory.MsgSetDenomBranding.decode(msg.value));
      case factory.MsgSetDenomConfig.typeUrl:
        return await setDenomConfigParts(l, factory.MsgSetDenomConfig.decode(msg.value));
      case factory.MsgDisableMinting.typeUrl:
        return await disableMintingParts(l, factory.MsgDisableMinting.decode(msg.value));
      case MsgCreateDao.typeUrl:
        return await createDaoParts(l, MsgCreateDao.decode(msg.value));
      case MsgSubmitProposal.typeUrl:
        if (depth >= MAX_EXEC_DEPTH)
          return { ...unknownParts(msg, 'Nested too deeply to read'), level: 'dangerous' };
        return await submitProposalParts(l, MsgSubmitProposal.decode(msg.value), depth);
      case MsgAdminExecute.typeUrl:
        if (depth >= MAX_EXEC_DEPTH)
          return { ...unknownParts(msg, 'Nested too deeply to read'), level: 'dangerous' };
        return await adminExecuteParts(l, MsgAdminExecute.decode(msg.value), depth);
      case DaoMsgVote.typeUrl:
        return daoVoteParts(DaoMsgVote.decode(msg.value));
      case MsgCancelProposal.typeUrl:
        return proposalActionParts(
          'cancel',
          'Cancel DAO proposal',
          MsgCancelProposal.decode(msg.value).proposalId,
          'withdraws your proposal from the vote',
        );
      case MsgSettleProposal.typeUrl:
        return proposalActionParts(
          'vote',
          'Settle DAO proposal',
          MsgSettleProposal.decode(msg.value).proposalId,
          'counts the votes and runs it if it passed',
        );
      case MsgCleanupProposal.typeUrl:
        return proposalActionParts(
          'vote',
          'Clean up DAO proposal',
          MsgCleanupProposal.decode(msg.value).proposalId,
          'deletes a finished proposal',
        );
      case MsgNominateAdmin.typeUrl:
        return nominateAdminParts(l, MsgNominateAdmin.decode(msg.value));
      case MsgAcceptAdminNomination.typeUrl:
        return daoIdParts(
          'admin',
          'Accept DAO admin',
          MsgAcceptAdminNomination.decode(msg.value).daoId,
          'you become its admin',
        );
      case MsgWithdrawAdminNomination.typeUrl:
        return daoIdParts(
          'cancel',
          'Withdraw DAO admin offer',
          MsgWithdrawAdminNomination.decode(msg.value).daoId,
          'cancels the pending handover',
        );
      case MsgUpdateDaoConfig.typeUrl:
        return await updateDaoConfigParts(l, MsgUpdateDaoConfig.decode(msg.value));
      case MsgUpdateMetadata.typeUrl:
        return updateMetadataParts(MsgUpdateMetadata.decode(msg.value));
      case MsgUpdateElectorate.typeUrl:
        return updateElectorateParts(MsgUpdateElectorate.decode(msg.value));
      case MsgUpdateMembers.typeUrl:
        return updateMembersParts(MsgUpdateMembers.decode(msg.value));
      case MsgStartRaffle.typeUrl:
        return await startRaffleParts(l, MsgStartRaffle.decode(msg.value));
      case MsgMoveIbcLockedCoins.typeUrl: {
        const { denom } = MsgMoveIbcLockedCoins.decode(msg.value);
        return await holderParts(l, 'burn', 'Move locked IBC coins', denom, 'to the burner');
      }
      case MsgAddArticle.typeUrl:
        return addArticleParts(MsgAddArticle.decode(msg.value));
      case MsgPayPublisherRespect.typeUrl:
        return await payRespectParts(l, MsgPayPublisherRespect.decode(msg.value));
      case MsgMultiSend.typeUrl:
        return await multiSendParts(l, MsgMultiSend.decode(msg.value));
      case MsgDelegate.typeUrl: {
        const m = MsgDelegate.decode(msg.value);
        return await stakingParts(l, 'Delegate', m.amount, `to ${l.who(m.validatorAddress)}`, [
          ['Validator', safeText(m.validatorAddress, 80), 'mono'],
        ]);
      }
      case MsgUndelegate.typeUrl: {
        const m = MsgUndelegate.decode(msg.value);
        return await stakingParts(l, 'Undelegate', m.amount, `from ${l.who(m.validatorAddress)}`, [
          ['Validator', safeText(m.validatorAddress, 80), 'mono'],
        ]);
      }
      case MsgBeginRedelegate.typeUrl: {
        const m = MsgBeginRedelegate.decode(msg.value);
        return await stakingParts(
          l,
          'Move stake',
          m.amount,
          `${l.who(m.validatorSrcAddress)} → ${l.who(m.validatorDstAddress)}`,
          [
            ['From', safeText(m.validatorSrcAddress, 80), 'mono'],
            ['To', safeText(m.validatorDstAddress, 80), 'mono'],
          ],
        );
      }
      case MsgWithdrawDelegatorReward.typeUrl:
        return withdrawRewardParts(l, MsgWithdrawDelegatorReward.decode(msg.value));
      case MsgCancelUnbondingDelegation.typeUrl: {
        const m = MsgCancelUnbondingDelegation.decode(msg.value);
        return await stakingParts(
          l,
          'Cancel unstaking',
          m.amount,
          `back to ${l.who(m.validatorAddress)}`,
          [
            ['Validator', safeText(m.validatorAddress, 80), 'mono'],
            ['Unstaking started at height', m.creationHeight.toString()],
          ],
        );
      }
      case MsgSetWithdrawAddress.typeUrl:
        return setWithdrawAddressParts(l, MsgSetWithdrawAddress.decode(msg.value));
      case MsgTransfer.typeUrl:
        return await transferParts(l, MsgTransfer.decode(msg.value));
      case MsgCreateVestingAccount.typeUrl:
        return await createVestingParts(l, MsgCreateVestingAccount.decode(msg.value));
      case MsgCreatePermanentLockedAccount.typeUrl:
        return await permanentLockedParts(l, MsgCreatePermanentLockedAccount.decode(msg.value));
      case MsgCreatePeriodicVestingAccount.typeUrl:
        return await periodicVestingParts(l, MsgCreatePeriodicVestingAccount.decode(msg.value));
      case MsgFundCommunityPool.typeUrl: {
        const m = MsgFundCommunityPool.decode(msg.value);
        return await givingParts(
          l,
          'send',
          'Fund community pool',
          m.amount,
          'to the community pool',
          [],
        );
      }
      case MsgDepositValidatorRewardsPool.typeUrl: {
        const m = MsgDepositValidatorRewardsPool.decode(msg.value);
        return await givingParts(
          l,
          'send',
          'Fund validator rewards',
          m.amount,
          `for the delegators of ${l.who(m.validatorAddress)}`,
          [['Validator', safeText(m.validatorAddress, 80), 'mono']],
        );
      }
      case MsgDeposit.typeUrl: {
        const m = MsgDeposit.decode(msg.value);
        const id = m.proposalId.toString();
        return await givingParts(l, 'vote', 'Deposit', m.amount, `on proposal #${id}`, [
          ['Proposal', `#${id}`],
        ]);
      }
      default:
        return guardianMsgParts(msg) ?? unknownParts(msg);
    }
  } catch {
    // Bytes that do not decode as their type, or a summariser bug: never a normal message.
    return msg.typeUrl === MsgGrant.typeUrl ||
      msg.typeUrl === MsgGrantAllowance.typeUrl ||
      WRAPPERS.has(msg.typeUrl)
      ? { ...unknownParts(msg, 'Unreadable'), level: 'dangerous' }
      : unknownParts(msg, `${safeText(msg.typeUrl)} (unreadable)`);
  }
}

/** A memo is whatever the dapp put there: one line, no invisible characters, cut when long. */
function memoText(raw: string): string | null {
  const oneLine = raw.replace(/[\r\n\t ]+/g, ' ').trim();
  if (oneLine === '') return null;
  const chars = Array.from(oneLine);
  const text = sanitiseText(chars.slice(0, MAX_MEMO).join(''));
  return chars.length > MAX_MEMO ? `${text}… (truncated)` : text;
}

/** A message of a type the wallet cannot read: it has no summary at all, not a failed check. */
export const isUnreadable = (m: MsgSummary): boolean => m.unreadable;

/**
 * Whether approving needs the user's explicit "I trust this" tick: a dangerous request, or one
 * with a message the wallet cannot show. The screen and the worker both ask this.
 */
export const needsTrust = (s: TxSummary): boolean =>
  s.level === 'dangerous' || s.messages.some(isUnreadable);

const riskiest = (levels: RiskLevel[]): RiskLevel =>
  levels.reduce<RiskLevel>((a, b) => (RISK_ORDER[b] > RISK_ORDER[a] ? b : a), 'normal');

/**
 * Plain words for what a transaction does and how risky it is. Lookups that fail (a node
 * error, an unknown market or pool) never throw: the text falls back to ids and base units.
 * Messages of a type the wallet does not know are `unknown`; authz and fee grants are
 * `dangerous`.
 */
export async function summarise(
  messages: AnyMsg[],
  ctx: SummaryContext,
  options: SummaryOptions = {},
): Promise<TxSummary> {
  const lookups = new Lookups(ctx);
  const parts = await Promise.all(messages.map((m) => partsOf(lookups, m)));
  const msgSummaries: MsgSummary[] = parts.map((p, i) => ({
    typeUrl: sanitiseText(messages[i]?.typeUrl ?? '', 256),
    level: p.level,
    icon: p.icon,
    title: p.title,
    line: `${p.hero} · ${p.sub}`,
    hero: p.hero,
    sub: p.sub,
    rows: p.rows,
    danger: p.danger ?? null,
    unreadable: p.unreadable === true,
  }));
  const level = riskiest(parts.map((p) => p.level));
  const memo = memoText(options.memo ?? '');
  const dangers = parts.flatMap((p) => [...(p.danger ? [p.danger] : []), ...(p.nested ?? [])]);

  const [only] = parts;
  if (parts.length === 1 && only) {
    return {
      level,
      title: only.title,
      hero: only.hero,
      sub: only.sub,
      rows: only.rows,
      messages: msgSummaries,
      dangers,
      memo,
    };
  }

  const markets = new Set(parts.map((p) => p.marketId));
  const [first] = parts;
  const shared =
    first?.marketId !== undefined && first.marketPair !== undefined && markets.size === 1
      ? first.marketPair
      : null;
  return {
    level,
    title: `${String(parts.length)} messages`,
    hero: 'Signed together',
    sub: shared ? `${shared} · both happen, or neither does` : 'All happen, or none does',
    rows: [],
    messages: msgSummaries,
    dangers,
    memo,
  };
}

/** Every string of a JSON value made safe to show. */
function sanitiseJson(value: unknown): unknown {
  if (typeof value === 'string') return sanitiseText(value);
  if (Array.isArray(value)) return value.map(sanitiseJson);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [sanitiseText(k), sanitiseJson(v)]),
    );
  return value;
}

/** Pretty JSON of the decoded messages, for the "Message details" sheet. */
export function rawJson(messages: AnyMsg[]): string {
  return JSON.stringify(
    messages.map((m) => {
      try {
        const decoded = decodeAny(m);
        if (!('unknown' in decoded)) return sanitiseJson(decoded);
      } catch {
        // Bytes that do not decode as their type are shown as they are.
      }
      return sanitiseJson({ typeUrl: m.typeUrl, unknown: true, value: base64.encode(m.value) });
    }),
    null,
    2,
  );
}
