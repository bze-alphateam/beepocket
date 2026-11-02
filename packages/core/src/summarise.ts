import { base64 } from '@scure/base';
import { formatAmount, displayPrice } from './amounts';
import { decodeAny } from './decode';
import type { ChainClient, Market, MarketOrder, Pool } from './net';
import { MsgSend } from './proto/cosmos/bank/v1beta1/tx';
import { SendAuthorization } from './proto/cosmos/bank/v1beta1/authz';
import { GenericAuthorization, Grant } from './proto/cosmos/authz/v1beta1/authz';
import { MsgExec, MsgGrant } from './proto/cosmos/authz/v1beta1/tx';
import type { Coin } from './proto/cosmos/base/v1beta1/coin';
import { VoteOption } from './proto/cosmos/gov/v1/gov';
import { MsgVote } from './proto/cosmos/gov/v1/tx';
import { MsgGrantAllowance } from './proto/cosmos/feegrant/v1beta1/tx';
import {
  AllowedMsgAllowance,
  BasicAllowance,
  PeriodicAllowance,
} from './proto/cosmos/feegrant/v1beta1/feegrant';
import { AuthorizationType, StakeAuthorization } from './proto/cosmos/staking/v1beta1/authz';
import { TransferAuthorization } from './proto/ibc/applications/transfer/v1/authz';
import { MsgFundBurner, MsgJoinRaffle } from './proto/bze/burner/tx';
import {
  MsgAddLiquidity,
  MsgCancelOrder,
  MsgCreateOrder,
  MsgFillOrders,
  MsgMultiSwap,
  MsgRemoveLiquidity,
} from './proto/bze/tradebin/tx';
import { sanitiseText } from './text';
import type { TokenInfo } from './tokens';
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
  /** The market a trade message acts on, for the shared-market line of a multi-message tx. */
  marketId?: string;
  marketPair?: string;
}

const MAX_TEXT = 128;
const MAX_UINT_DIGITS = 78;
const LP_DECIMALS = 6;
const MAX_ROUTE_HOPS = 32;
const MAX_MEMO = 200;
const RISK_ORDER: Record<RiskLevel, number> = { normal: 0, unknown: 1, dangerous: 2 };

/** Untrusted text for display: no unsafe characters, bounded. */
const safeText = (raw: string, max = MAX_TEXT): string => sanitiseText(raw, max);

/** An unsigned integer string, or null for anything else. */
function toUint(raw: string): bigint | null {
  return raw.length > 0 && raw.length <= MAX_UINT_DIGITS && /^\d+$/.test(raw) ? BigInt(raw) : null;
}

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

/** One summarising run's lookups: each is made at most once and never throws. */
class Lookups {
  private readonly tokenCache = new Map<string, Promise<TokenView>>();
  private marketsCache: Promise<Map<string, Market>> | undefined;
  private poolsCache: Promise<Map<string, Pool>> | undefined;

  constructor(readonly ctx: SummaryContext) {}

  token(denom: string): Promise<TokenView> {
    let cached = this.tokenCache.get(denom);
    if (!cached) {
      cached = this.ctx.tokens.resolve(denom).then(
        (t) => ({
          symbol: sanitiseText(t.symbol, 64),
          decimals: t.decimals,
          exact: t.source !== 'fallback',
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

  /** `1,000.00 BZE`; base units with a note when the token's decimals are unknown. */
  async money(denom: string, amount: bigint | string): Promise<string> {
    const t = await this.token(denom);
    const value = typeof amount === 'bigint' ? amount : toUint(amount);
    if (value === null) return `${safeText(String(amount), 40)} ${t.symbol}`;
    const text = formatAmount(value, t.decimals);
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
  return { level: 'normal', icon: 'send', title: 'Send', hero, sub: `to ${to}`, rows };
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
    (current === null || current === msg.minOutput.denom);
  if (current === null || current !== msg.minOutput.denom) path.push(out);
  return { path, consistent };
}

async function swapParts(l: Lookups, msg: MsgMultiSwap): Promise<Parts> {
  const [pay, get, route] = await Promise.all([
    l.money(msg.input.denom, msg.input.amount),
    l.money(msg.minOutput.denom, msg.minOutput.amount),
    routePath(l, msg),
  ]);
  return {
    // A route that does not end in the denom the swap promises is not what it says it is.
    level: route.consistent ? 'normal' : 'unknown',
    icon: 'swap',
    title: 'Swap',
    hero: pay,
    sub: `for at least ${get}`,
    rows: [
      ['Route', route.path.join(' → ')],
      ['You pay', pay],
      ['You get at least', get],
    ],
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

async function fillOrdersParts(l: Lookups, msg: MsgFillOrders): Promise<Parts> {
  const known = msg.orderType === 'buy' || msg.orderType === 'sell';
  const market = await l.market(msg.marketId);
  const pair = market ? await l.pair(market.base, market.quote) : safeText(msg.marketId);
  let total = 0n;
  let valid = true;
  for (const item of msg.orders) {
    const amount = toUint(item.amount);
    if (amount === null || !isDecimal(item.price)) valid = false;
    else total += amount;
  }
  const count = msg.orders.length;
  const totalText = !valid
    ? 'Unreadable amounts'
    : market
      ? await l.money(market.base, total)
      : `${total.toString()} (base units)`;
  // The type names the orders being filled; the signer takes the other side.
  const side = msg.orderType === 'buy' ? 'you sell' : msg.orderType === 'sell' ? 'you buy' : '?';
  return {
    level: known && valid ? 'normal' : 'unknown',
    icon: 'order',
    title: 'Fill orders',
    hero: `${String(count)} ${count === 1 ? 'order' : 'orders'}`,
    sub: `${pair} · ${side}`,
    rows: [
      ['Market', pair],
      ['Total amount', totalText],
    ],
    marketId: msg.marketId,
    ...(market ? { marketPair: pair } : {}),
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
    level: 'normal',
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
    level: 'normal',
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
    danger: {
      title: `This gives ${grantee} power over your address`,
      text: 'They can make transactions from this address until the permission expires or you revoke it.',
    },
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
    danger: {
      title: `This lets ${grantee} spend your tokens on fees`,
      text: 'Fees they pay are taken from this address until the allowance runs out or expires.',
    },
  };
}

function execParts(l: Lookups, msg: MsgExec): Parts {
  const grantee = l.who(msg.grantee);
  const inner = msg.msgs.map((m) => lastSegment(m.typeUrl));
  return {
    level: 'dangerous',
    icon: 'grant',
    title: 'Act for other accounts',
    hero: `${String(inner.length)} ${inner.length === 1 ? 'message' : 'messages'}`,
    sub: `run by ${grantee}`,
    rows: [
      ['Grantee', safeText(msg.grantee, 80), 'mono'],
      ['Messages', inner.slice(0, 10).join(', ') + (inner.length > 10 ? ', …' : '')],
    ],
    danger: {
      title: 'This runs messages on behalf of other accounts',
      text: 'The messages inside are executed with the permissions other addresses gave. Continue only if you expect that.',
    },
  };
}

async function partsOf(l: Lookups, msg: AnyMsg): Promise<Parts> {
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
        return execParts(l, MsgExec.decode(msg.value));
      default:
        return unknownParts(msg);
    }
  } catch {
    // Bytes that do not decode as their type, or a summariser bug: never a normal message.
    return msg.typeUrl === MsgGrant.typeUrl ||
      msg.typeUrl === MsgGrantAllowance.typeUrl ||
      msg.typeUrl === MsgExec.typeUrl
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
  }));
  const level = riskiest(parts.map((p) => p.level));
  const memo = memoText(options.memo ?? '');
  const dangers = parts.flatMap((p) => (p.danger ? [p.danger] : []));

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
