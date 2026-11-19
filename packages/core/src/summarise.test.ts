import { bech32 } from '@scure/base';
import { describe, expect, it, vi } from 'vitest';
import { stubChain, stubScan } from '../test/stubs';
import {
  needsTrust,
  parseAmount,
  rawJson,
  summarise,
  TokenResolver,
  type AnyMsg,
  type Market,
  type MarketOrder,
  type Pool,
  type SummaryContext,
  type TxSummary,
} from './index';
import { GenericAuthorization } from './proto/cosmos/authz/v1beta1/authz';
import { MsgExec, MsgGrant } from './proto/cosmos/authz/v1beta1/tx';
import { SendAuthorization } from './proto/cosmos/bank/v1beta1/authz';
import { BasicAllowance, PeriodicAllowance } from './proto/cosmos/feegrant/v1beta1/feegrant';
import { MsgGrantAllowance } from './proto/cosmos/feegrant/v1beta1/tx';
import { VoteOption } from './proto/cosmos/gov/v1/gov';
import { MsgDeposit, MsgVote } from './proto/cosmos/gov/v1/tx';
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
import * as factory from './proto/bze/tokenfactory/tx';
import { MsgAddArticle, MsgPayPublisherRespect } from './proto/bze/cointrunk/tx';
import * as dao from './proto/bze/dao/tx';
import {
  DaoType,
  DepositRefundPolicy,
  FundsDestination,
  VoteOption as DaoVoteOption,
} from './proto/bze/dao/store';
import * as guardian from './proto/bze/guardian/v1/tx';
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
import { GOVERNANCE_ONLY as GOVERNED } from './governance';
import registryV820 from '../test/fixtures/registry/v8.2.0.json';
import registryV83 from '../test/fixtures/registry/v8.3.json';
import { MsgTransfer } from './proto/ibc/applications/transfer/v1/tx';
import { Any } from './proto/google/protobuf/any';

const ME = 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g';
const ALEX = 'bze1q8t5x0yvl9jzx5pq4m3vvrmkz8cndhqk8z9rfc';
const STRANGER = 'bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p';
/** Another address of the same wallet. */
const ME2 = bech32.encode('bze', bech32.toWords(new Uint8Array(20).fill(7)));
const VDL = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl';
const USDC = `ibc/${'AB'.repeat(32)}`;
/** A quote token with more decimals than amounts are usually shown with. */
const ETH = `ibc/${'CD'.repeat(32)}`;

const BZE_USDC: Market = { id: `ubze/${USDC}`, base: 'ubze', quote: USDC };
const VDL_BZE: Market = { id: `${VDL}/ubze`, base: VDL, quote: 'ubze' };
const BZE_ETH: Market = { id: `ubze/${ETH}`, base: 'ubze', quote: ETH };
const ETH_BZE: Market = { id: `${ETH}/ubze`, base: ETH, quote: 'ubze' };
const MARKETS = [BZE_USDC, VDL_BZE, BZE_ETH, ETH_BZE];

const pool = (id: string, base: string, quote: string): Pool => ({
  id,
  base,
  quote,
  reserveBase: 1n,
  reserveQuote: 1n,
});
const POOLS = [pool('pool-bze-usdc', 'ubze', USDC), pool('pool-vdl-bze', VDL, 'ubze')];

interface Codec<P, M> {
  typeUrl: string;
  fromPartial(p: P): M;
  encode(m: M): { finish(): Uint8Array };
}
function pack<P, M>(codec: Codec<P, M>, partial: P): AnyMsg {
  return { typeUrl: codec.typeUrl, value: codec.encode(codec.fromPartial(partial)).finish() };
}
const wrap = <P, M>(codec: Codec<P, M>, partial: P): Any => Any.fromPartial(pack(codec, partial));

function context(overrides: Partial<SummaryContext> = {}): SummaryContext {
  const chain = stubChain({
    denomMetadata: vi.fn((denom: string) =>
      Promise.resolve(
        denom === VDL
          ? { name: 'Vidulum', symbol: 'VDL', display: 'VDL', exponent: 6, description: '' }
          : null,
      ),
    ),
    denomBranding: vi.fn().mockResolvedValue(null),
    markets: vi.fn().mockResolvedValue(MARKETS),
    liquidityPools: vi.fn().mockResolvedValue(POOLS),
    marketOrder: vi.fn().mockResolvedValue(null),
    tradebinParams: vi.fn().mockResolvedValue({
      nativeDenom: 'ubze',
      minNativeLiquidityForModuleSwap: 1n,
      createMarketFee: { denom: 'ubze', amount: 25_000_000_000n },
      marketMakerFee: { denom: 'ubze', amount: 1_000n },
      marketTakerFee: { denom: 'ubze', amount: 100_000n },
    }),
    tokenFactoryParams: vi.fn().mockResolvedValue({
      createDenomFee: { denom: 'ubze', amount: 25_000_000_000n },
    }),
  });
  const scan = stubScan({
    token: vi.fn((denom: string) =>
      Promise.resolve(
        denom === USDC
          ? { denom, symbol: 'USDC', name: 'USD Coin', exponent: 6, kind: 'ibc', halted: false }
          : denom === ETH
            ? { denom, symbol: 'ETH', name: 'Ether', exponent: 18, kind: 'ibc', halted: false }
            : null,
      ),
    ),
  });
  return {
    tokens: new TokenResolver(chain, scan),
    markets: chain,
    orders: chain,
    fees: chain,
    ownAddresses: [ME, ME2],
    addressBook: (a) => (a === ALEX ? 'Alex' : null),
    ...overrides,
  };
}

const run = (messages: AnyMsg[], overrides: Partial<SummaryContext> = {}, memo?: string) =>
  summarise(messages, context(overrides), memo === undefined ? {} : { memo });
const headline = (s: TxSummary) => `${s.title} · ${s.hero} · ${s.sub}`;

const send = (to = ALEX, amount = [{ denom: 'ubze', amount: '1000000000' }]) =>
  pack(MsgSend, { fromAddress: ME, toAddress: to, amount });
const swap = (routes = ['pool-bze-usdc'], input = 'ubze', output = USDC) =>
  pack(MsgMultiSwap, {
    creator: ME,
    routes,
    input: { denom: input, amount: '1000000000' },
    minOutput: { denom: output, amount: '318200000' },
  });
const order = (orderType: string, amount = '500000000', price = '0.335', marketId = BZE_USDC.id) =>
  pack(MsgCreateOrder, { creator: ME, orderType, amount, price, marketId });
const vote = (option: VoteOption) => pack(MsgVote, { voter: ME, proposalId: 42n, option });
const grant = (expiration?: Date) =>
  pack(MsgGrant, {
    granter: ME,
    grantee: ALEX,
    grant: {
      authorization: wrap(GenericAuthorization, { msg: '/cosmos.bank.v1beta1.MsgSend' }),
      ...(expiration ? { expiration } : {}),
    },
  });
/** A grant from the connected address to a stranger. */
const selfGrant = () =>
  pack(MsgGrant, {
    granter: ME,
    grantee: STRANGER,
    grant: {
      authorization: wrap(GenericAuthorization, { msg: '/cosmos.bank.v1beta1.MsgSend' }),
    },
  });
/** An authz exec run by the connected address. */
const exec = (...msgs: AnyMsg[]) =>
  pack(MsgExec, { grantee: ME, msgs: msgs.map((m) => Any.fromPartial(m)) });
/** A type outside BZE's modules and the cosmos/ibc types its dapps send. */
const wasm: AnyMsg = {
  typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
  value: new Uint8Array([1, 2, 3]),
};

describe('Send', () => {
  it('names a contact and shows the amount', async () => {
    const s = await run([send()]);
    expect(headline(s)).toBe('Send · 1,000.00 BZE · to Alex');
    expect(s.level).toBe('normal');
    expect(s.rows).toEqual([
      ['To', ALEX, 'mono'],
      ['Amount', '1,000.00 BZE'],
    ]);
    expect(s.messages[0]).toMatchObject({ icon: 'send', title: 'Send', level: 'normal' });
  });

  it('shortens an address that is not in the address book', async () => {
    const s = await run([send(STRANGER)]);
    expect(s.sub).toBe(`to ${STRANGER.slice(0, 8)}…${STRANGER.slice(-6)}`);
  });

  it('summarises several coins as "N tokens" with one amount row each', async () => {
    const s = await run([
      send(ALEX, [
        { denom: 'ubze', amount: '1500000' },
        { denom: USDC, amount: '2000000' },
      ]),
    ]);
    expect(s.hero).toBe('2 tokens');
    expect(s.rows.filter((r) => r[0] === 'Amount').map((r) => r[1])).toEqual([
      '1.50 BZE',
      '2.00 USDC',
    ]);
  });

  it('formats a factory token with its on-chain decimals', async () => {
    const s = await run([send(ALEX, [{ denom: VDL, amount: '2500000' }])]);
    expect(s.hero).toBe('2.50 VDL');
  });
});

describe('Swap', () => {
  it('reproduces the canvas example', async () => {
    const s = await run([swap()]);
    expect(headline(s)).toBe('Swap · 1,000.00 BZE · for at least 318.20 USDC');
    expect(s.rows).toEqual([
      ['Route', 'BZE → USDC'],
      ['You pay', '1,000.00 BZE'],
      ['You get at least', '318.20 USDC'],
      ['Trading fee', '0.10 BZE'],
    ]);
    expect(s.level).toBe('normal');
  });

  it('marks a route through a pool it cannot find as unknown', async () => {
    const s = await run([swap(['pool-nowhere'], 'ubze', USDC)]);
    expect(s.level).toBe('unknown');
    expect(s.messages[0]?.level).toBe('unknown');
  });

  it('lists every hop of a multi-pool route', async () => {
    const s = await run([swap(['pool-vdl-bze', 'pool-bze-usdc'], VDL, USDC)]);
    expect(s.rows[0]).toEqual(['Route', 'VDL → BZE → USDC']);
    expect(s.level).toBe('normal');
  });

  it('shows the pool id of a hop it cannot resolve', async () => {
    const s = await run([swap(['pool-nope'])]);
    expect(s.rows[0]).toEqual(['Route', 'BZE → [pool-nope] → USDC']);
  });

  it('is unknown when the route does not end in the promised token', async () => {
    const s = await run([swap(['pool-vdl-bze'], VDL, USDC)]);
    expect(s.level).toBe('unknown');
  });

  it('is unknown without any route', async () => {
    expect((await run([swap([])])).level).toBe('unknown');
  });
});

describe('orders', () => {
  it('reproduces the canvas sell order', async () => {
    const s = await run([order('sell')]);
    expect(headline(s)).toBe('Sell order · 500.00 BZE · BZE/USDC at 0.3350 USDC');
    expect(s.rows).toEqual([
      ['Market', 'BZE/USDC'],
      ['Amount', '500.00 BZE'],
      ['Price', '0.3350 USDC'],
      ['Total', '167.50 USDC'],
      ['Trading fee', '0.001 BZE if it waits on the book, 0.10 BZE if it fills at once'],
    ]);
    expect(s.messages[0]?.icon).toBe('order');
  });

  it('titles a buy order and rounds what a buyer pays up, what a seller gets down', async () => {
    const buy = await run([order('buy', '3', '0.5')]);
    const sell = await run([order('sell', '3', '0.5')]);
    expect(buy.title).toBe('Buy order');
    expect(buy.rows.find((r) => r[0] === 'Total')?.[1]).toBe('0.000002 USDC');
    expect(sell.rows.find((r) => r[0] === 'Total')?.[1]).toBe('0.000001 USDC');
  });

  it('prices a market whose quote is another token', async () => {
    const s = await run([order('buy', '2000000', '1500000', VDL_BZE.id)]);
    expect(s.sub).toBe('VDL/BZE at 1,500,000.0000 BZE');
  });

  it('shows raw units for a market it cannot find', async () => {
    const s = await run([order('sell', '500', '0.335', 'nope/market')]);
    expect(s.hero).toBe('500 (base units)');
    expect(s.sub).toBe('on nope/market at 0.335 (base units)');
    expect(s.level).toBe('normal');
  });

  it('is unknown for an order type other than buy or sell', async () => {
    const s = await run([order('swap')]);
    expect(s.title).toBe('Order');
    expect(s.level).toBe('unknown');
  });

  it('is unknown when the amount or price is not a number', async () => {
    expect((await run([order('buy', '12abc')])).level).toBe('unknown');
    expect((await run([order('buy', '5', '1e5')])).level).toBe('unknown');
  });

  it('flags amounts as base units when a token has no known decimals', async () => {
    const ctx = context({
      tokens: { resolve: () => Promise.reject(new Error('node down')) },
    });
    const s = await summarise([order('sell')], ctx);
    expect(s.hero).toContain('(base units)');
    expect(s.sub).toContain('(base units)');
  });
});

describe('Cancel order', () => {
  const cancel = (orderType = 'buy', marketId = BZE_USDC.id) =>
    pack(MsgCancelOrder, { creator: ME, marketId, orderId: '000123', orderType });
  const open = (overrides: Partial<MarketOrder> = {}): MarketOrder => ({
    id: '000123',
    marketId: BZE_USDC.id,
    orderType: 'buy',
    amount: 250_000_000n,
    price: '0.3',
    owner: ME,
    ...overrides,
  });

  it('describes the order it finds', async () => {
    const marketOrder = vi.fn().mockResolvedValue(open());
    const s = await run([cancel()], { orders: { marketOrder } });
    expect(headline(s)).toBe('Cancel buy order · 250.00 BZE · at 0.3000 USDC');
    expect(s.rows).toEqual([
      ['Market', 'BZE/USDC'],
      ['Order id', '000123', 'mono'],
    ]);
    expect(marketOrder).toHaveBeenCalledWith(BZE_USDC.id, 'buy', '000123');
    expect(s.messages[0]?.icon).toBe('cancel');
  });

  it('says "Cancel sell order" for a sell order', async () => {
    expect((await run([cancel('sell')])).title).toBe('Cancel sell order');
  });

  it('falls back to the order id and the pair when the order is gone', async () => {
    const s = await run([cancel()]);
    expect(s.hero).toBe('Order 000123');
    expect(s.sub).toBe('on BZE/USDC');
  });

  it('falls back when the order lookup fails', async () => {
    const marketOrder = vi.fn().mockRejectedValue(new Error('node down'));
    const s = await run([cancel()], { orders: { marketOrder } });
    expect(s.hero).toBe('Order 000123');
  });

  it('does not trust an order that belongs to another market', async () => {
    const marketOrder = vi.fn().mockResolvedValue(open({ marketId: VDL_BZE.id }));
    const s = await run([cancel()], { orders: { marketOrder } });
    expect(s.hero).toBe('Order 000123');
  });

  it('shows the market id when the market is unknown', async () => {
    const s = await run([cancel('buy', 'nope/market')]);
    expect(s.sub).toBe('on nope/market');
    expect(s.rows[0]).toEqual(['Market', 'nope/market', 'mono']);
  });
});

describe('Fill orders', () => {
  interface Item {
    price: string;
    amount: string;
  }
  const fill = (
    orderType: string,
    items: Item[] = [
      { price: '0.3', amount: '100000000' },
      { price: '0.31', amount: '50000000' },
    ],
    marketId = BZE_USDC.id,
  ) => pack(MsgFillOrders, { creator: ME, marketId, orderType, orders: items });

  /** `amount × price` in quote base units, as `exact / scale`. */
  const product = ({ amount, price }: Item): { exact: bigint; scale: bigint } => {
    const [whole = '', fraction = ''] = price.split('.');
    return {
      exact: BigInt(amount) * BigInt(whole + fraction),
      scale: 10n ** BigInt(fraction.length),
    };
  };
  const ceil = (item: Item): bigint => {
    const { exact, scale } = product(item);
    return (exact + scale - 1n) / scale;
  };
  const trunc = (item: Item): bigint => {
    const { exact, scale } = product(item);
    return exact / scale;
  };
  /** The most the chain can take for one order: the truncated product, plus one unit of dust. */
  const mostTaken = (item: Item): bigint => {
    const { exact, scale } = product(item);
    return exact / scale + (exact % scale === 0n ? 0n : 1n);
  };
  const sum = (items: Item[], f: (item: Item) => bigint): bigint =>
    items.reduce((total, item) => total + f(item), 0n);
  /** The quote amount in a hero like `You pay up to 1,234.50 USDC`, in base units. */
  const shownQuote = (hero: string, prefix: string, decimals = 6): bigint => {
    expect(hero.startsWith(prefix)).toBe(true);
    const text = hero.slice(prefix.length).split(' ')[0]?.replace(/,/g, '') ?? '';
    const value = parseAmount(text, decimals);
    if (value instanceof Error) throw value;
    return value;
  };

  it('shows what the signer pays, what they get and every order price when buying', async () => {
    const s = await run([fill('sell')]);
    expect(headline(s)).toBe(
      'Fill orders · You pay up to 45.50 USDC · You get 150.00 BZE · BZE/USDC · 2 orders',
    );
    expect(s.level).toBe('normal');
    expect(s.rows).toEqual([
      ['Market', 'BZE/USDC'],
      ['Order 1', '100.00 BZE @ 0.3000 USDC/BZE'],
      ['Order 2', '50.00 BZE @ 0.3100 USDC/BZE'],
      ['You get', '150.00 BZE'],
      ['You pay up to', '45.50 USDC'],
      ['Trading fee', '0.10 BZE'],
    ]);
  });

  it('shows what the signer gives, what they get and every order price when selling', async () => {
    const s = await run([fill('buy')]);
    expect(headline(s)).toBe(
      'Fill orders · You get 45.50 USDC · You pay 150.00 BZE · BZE/USDC · 2 orders',
    );
    expect(s.level).toBe('normal');
    expect(s.rows).toEqual([
      ['Market', 'BZE/USDC'],
      ['Order 1', '100.00 BZE @ 0.3000 USDC/BZE'],
      ['Order 2', '50.00 BZE @ 0.3100 USDC/BZE'],
      ['You pay', '150.00 BZE'],
      ['You get', '45.50 USDC'],
      ['Trading fee', '0.10 BZE'],
    ]);
  });

  it('tells apart fills that differ only in price', async () => {
    const cheap = await run([fill('sell', [{ price: '0.3', amount: '10000000' }])]);
    const dear = await run([fill('sell', [{ price: '300', amount: '10000000' }])]);
    expect(cheap.hero).toBe('You pay up to 3.00 USDC');
    expect(dear.hero).toBe('You pay up to 3,000.00 USDC');
    expect(cheap.rows).toContainEqual(['Order 1', '10.00 BZE @ 0.3000 USDC/BZE']);
    expect(dear.rows).toContainEqual(['Order 1', '10.00 BZE @ 300.0000 USDC/BZE']);
    expect(headline(cheap)).not.toBe(headline(dear));
  });

  it('uses the singular for one order', async () => {
    const s = await run([fill('sell', [{ price: '1', amount: '1' }])]);
    expect(s.sub.endsWith(' · 1 order')).toBe(true);
  });

  const cases: Record<string, Item[]> = {
    'a whole price': [{ price: '2', amount: '100000000' }],
    'a fractional product': [{ price: '0.333333', amount: '3' }],
    'orders that each leave a fraction': [
      { price: '0.5', amount: '1' },
      { price: '0.5', amount: '1' },
    ],
    'several mixed orders': [
      { price: '0.123456789', amount: '1234567' },
      { price: '1.5', amount: '7' },
      { price: '3', amount: '1000000' },
    ],
  };

  for (const [name, items] of Object.entries(cases)) {
    it(`never shows less to pay than can be taken, for ${name}`, async () => {
      const s = await run([fill('sell', items)]);
      expect(s.level).toBe('normal');
      const shown = shownQuote(s.hero, 'You pay up to ');
      expect(shown).toBe(sum(items, ceil));
      expect(shown >= sum(items, mostTaken)).toBe(true);
    });

    it(`never shows more to get than a full fill pays, for ${name}`, async () => {
      const s = await run([fill('buy', items)]);
      expect(s.level).toBe('normal');
      expect(shownQuote(s.hero, 'You get ')).toBe(sum(items, trunc));
    });
  }

  it('shows the amount to pay in full when the quote token has many decimals', async () => {
    const s = await run([
      fill('sell', [{ price: '0.333333333333333333', amount: '3' }], BZE_ETH.id),
    ]);
    expect(s.hero).toBe('You pay up to 0.000000000000000001 ETH');
    expect(shownQuote(s.hero, 'You pay up to ', 18)).toBe(1n);
  });

  it('rounds a fractional product up to pay and down to get', async () => {
    const items = [{ price: '0.333333', amount: '3000001' }];
    expect((await run([fill('sell', items)])).hero).toBe('You pay up to 1.00 USDC');
    expect((await run([fill('buy', items)])).hero).toBe('You get 0.999999 USDC');
  });

  it('reads prices written with leading or trailing zeros', async () => {
    const s = await run([
      fill('sell', [
        { price: '007.5', amount: '2000000' },
        { price: '0.50', amount: '2000000' },
      ]),
    ]);
    expect(s.hero).toBe('You pay up to 16.00 USDC');
    expect(s.rows).toContainEqual(['Order 1', '2.00 BZE @ 7.5000 USDC/BZE']);
    expect(s.rows).toContainEqual(['Order 2', '2.00 BZE @ 0.5000 USDC/BZE']);
  });

  it('shows the amount to give in full when the base token has many decimals', async () => {
    const s = await run([fill('buy', [{ price: '1', amount: '1234567' }], ETH_BZE.id)]);
    expect(s.sub).toBe('You pay 0.000000000001234567 ETH · ETH/BZE · 1 order');
  });

  it('is unknown when there are no orders', async () => {
    expect((await run([fill('sell', [])])).level).toBe('unknown');
    expect((await run([fill('buy', [])])).level).toBe('unknown');
  });

  it('is unknown when the market is unknown, and still lists each order', async () => {
    const s = await run([fill('sell', undefined, 'nope/market')]);
    expect(s.level).toBe('unknown');
    expect(s.rows).toContainEqual(['Order 1', '100000000 @ 0.3 (base units)']);
    expect(s.rows).toContainEqual(['Order 2', '50000000 @ 0.31 (base units)']);
  });

  it('is unknown when an item is unreadable or the type is not buy/sell', async () => {
    expect((await run([fill('sell', [{ price: '1', amount: 'x' }])])).level).toBe('unknown');
    expect((await run([fill('sell', [{ price: 'abc', amount: '1' }])])).level).toBe('unknown');
    expect((await run([fill('sell', [{ price: '1e3', amount: '1' }])])).level).toBe('unknown');
    expect((await run([fill('both')])).level).toBe('unknown');
  });
});

describe('liquidity', () => {
  it('summarises adding liquidity', async () => {
    const s = await run([
      pack(MsgAddLiquidity, {
        creator: ME,
        poolId: 'pool-bze-usdc',
        baseAmount: '100000000',
        quoteAmount: '33500000',
        // LP shares have 12 decimals.
        minLpTokens: '5000000000000',
      }),
    ]);
    expect(headline(s)).toBe('Add liquidity · 100.00 BZE + 33.50 USDC · to the BZE/USDC pool');
    expect(s.rows).toEqual([
      ['Pool', 'BZE/USDC'],
      ['Min LP tokens', '5.00'],
    ]);
    expect(s.messages[0]?.icon).toBe('liquidity');
  });

  it('summarises removing liquidity', async () => {
    const s = await run([
      pack(MsgRemoveLiquidity, {
        creator: ME,
        poolId: 'pool-bze-usdc',
        lpTokens: '12500000000000',
        minBase: '10000000',
        minQuote: '3350000',
      }),
    ]);
    expect(headline(s)).toBe('Remove liquidity · 12.50 LP · from the BZE/USDC pool');
    expect(s.rows).toEqual([
      ['Pool', 'BZE/USDC'],
      ['You get at least', '10.00 BZE + 3.35 USDC'],
    ]);
  });

  it('degrades to the pool id and base units for an unknown pool', async () => {
    const s = await run([
      pack(MsgAddLiquidity, {
        creator: ME,
        poolId: 'pool-nope',
        baseAmount: '7',
        quoteAmount: '8',
        minLpTokens: '1',
      }),
    ]);
    expect(s.hero).toBe('7 (base units) + 8 (base units)');
    expect(s.sub).toBe('to pool pool-nope');
    expect(s.level).toBe('normal');
  });
});

describe('burner', () => {
  it('summarises a burn', async () => {
    const s = await run([pack(MsgFundBurner, { creator: ME, amount: '1500000ubze' })]);
    expect(headline(s)).toBe('Burn · 1.50 BZE · sent to the burner');
    expect(s.messages[0]?.icon).toBe('burn');
  });

  it('reads several coins like the chain does', async () => {
    const amount = `2000000ubze, 1000000${VDL}`;
    const s = await run([pack(MsgFundBurner, { creator: ME, amount })]);
    expect(s.hero).toBe('2.00 BZE, 1.00 VDL');
  });

  it('is unknown when the coin string cannot be read', async () => {
    for (const amount of ['', 'lots', '12', '1ubze,,2ubze', '-5ubze']) {
      const s = await run([pack(MsgFundBurner, { creator: ME, amount })]);
      expect(s.level).toBe('unknown');
    }
  });

  it('summarises joining a raffle and says the price is on top', async () => {
    const s = await run([pack(MsgJoinRaffle, { creator: ME, denom: VDL, tickets: 3n })]);
    expect(headline(s)).toBe('Join raffle · 3 tickets · VDL raffle');
    expect(s.rows[0]).toEqual(['Raffle', 'VDL']);
    expect(s.rows[1]).toEqual(['Tickets', '3']);
    expect(s.rows[2]?.[1]).toContain('ticket price');
    const one = await run([pack(MsgJoinRaffle, { creator: ME, denom: VDL, tickets: 1n })]);
    expect(one.hero).toBe('1 ticket');
  });
});

describe('Vote', () => {
  it('names every option', async () => {
    const heroes = await Promise.all(
      [
        VoteOption.VOTE_OPTION_YES,
        VoteOption.VOTE_OPTION_NO,
        VoteOption.VOTE_OPTION_NO_WITH_VETO,
        VoteOption.VOTE_OPTION_ABSTAIN,
      ].map(async (option) => (await run([vote(option)])).hero),
    );
    expect(heroes).toEqual(['Yes', 'No', 'No with veto', 'Abstain']);
    const s = await run([vote(VoteOption.VOTE_OPTION_YES)]);
    expect(headline(s)).toBe('Vote · Yes · on proposal #42');
    expect(s.rows).toEqual([
      ['Proposal', '#42'],
      ['Vote', 'Yes'],
    ]);
  });

  it('is unknown for an unspecified vote', async () => {
    const s = await run([vote(VoteOption.VOTE_OPTION_UNSPECIFIED)]);
    expect(s.hero).toBe('Unknown vote');
    expect(s.level).toBe('unknown');
  });
});

describe('dangerous messages', () => {
  it('flags an authz grant with its red-box text', async () => {
    const s = await run([grant(new Date('2027-03-04T05:06:07Z'))]);
    expect(s.level).toBe('dangerous');
    expect(headline(s)).toBe('Grant permission · Any MsgSend · to Alex');
    expect(s.rows).toEqual([
      ['Grantee', ALEX, 'mono'],
      ['Permission', 'Any MsgSend'],
      ['Expires', '2027-03-04 05:06 UTC'],
    ]);
    expect(s.dangers).toEqual([
      {
        title: 'This gives Alex power over your address',
        text: 'They can make transactions from this address until the permission expires or you revoke it.',
      },
    ]);
    expect(s.messages[0]).toMatchObject({ level: 'dangerous', icon: 'grant' });
  });

  it('says a grant without expiry never expires', async () => {
    expect((await run([grant()])).rows[2]).toEqual(['Expires', 'Never']);
  });

  it('states the limit of a send authorization and its absence', async () => {
    const send = (spendLimit: { denom: string; amount: string }[], allowList: string[] = []) =>
      pack(MsgGrant, {
        granter: ME,
        grantee: STRANGER,
        grant: { authorization: wrap(SendAuthorization, { spendLimit, allowList }) },
      });
    const limited = await run([send([{ denom: 'ubze', amount: '5000000' }])]);
    expect(limited.hero).toBe('Send up to 5.00 BZE to any address');
    const open = await run([send([], [ALEX])]);
    expect(open.hero).toBe('Send with no limit to 1 chosen address');
  });

  it('names a grant of a type it does not know', async () => {
    const odd = pack(MsgGrant, {
      granter: ME,
      grantee: ALEX,
      grant: {
        authorization: Any.fromPartial({
          typeUrl: '/x.v1.MagicAuthorization',
          value: new Uint8Array(),
        }),
      },
    });
    const s = await run([odd]);
    expect(s.hero).toBe('MagicAuthorization');
    expect(s.level).toBe('dangerous');
  });

  it('flags a fee grant, with its limit or without one', async () => {
    const fee = (allowance: Any) =>
      pack(MsgGrantAllowance, { granter: ME, grantee: ALEX, allowance });
    const limited = await run([
      fee(wrap(BasicAllowance, { spendLimit: [{ denom: 'ubze', amount: '2000000' }] })),
    ]);
    expect(limited.level).toBe('dangerous');
    expect(headline(limited)).toBe('Pay fees for another address · 2.00 BZE · for Alex');
    expect(limited.dangers[0]).toEqual({
      title: 'This lets Alex spend your tokens on fees',
      text: 'Fees they pay are taken from this address until the allowance runs out or expires.',
    });
    expect(limited.rows).toEqual([
      ['Grantee', ALEX, 'mono'],
      ['Limit', '2.00 BZE'],
      ['Expires', 'Never'],
    ]);
    const open = await run([
      fee(wrap(BasicAllowance, { spendLimit: [], expiration: new Date('2027-01-02T03:04:00Z') })),
    ]);
    expect(open.hero).toBe('No limit');
    expect(open.rows[2]).toEqual(['Expires', '2027-01-02 03:04 UTC']);
  });

  it('does not call a periodic allowance limitless, nor an unknown one "no limit"', async () => {
    const fee = (allowance: Any) =>
      pack(MsgGrantAllowance, { granter: ME, grantee: ALEX, allowance });
    const periodic = await run([
      fee(
        wrap(PeriodicAllowance, {
          basic: { spendLimit: [] },
          period: { seconds: 86400n, nanos: 0 },
          periodSpendLimit: [{ denom: 'ubze', amount: '1000000' }],
        }),
      ),
    ]);
    expect(periodic.hero).toBe('No limit in total, 1.00 BZE per period');
    const odd = await run([
      fee(Any.fromPartial({ typeUrl: '/x.v1.OddAllowance', value: new Uint8Array() })),
    ]);
    expect(odd.hero).toBe('Unknown limit');
    expect(odd.level).toBe('dangerous');
  });

  it('flags any authz exec, whatever it wraps', async () => {
    for (const inner of [send(), vote(VoteOption.VOTE_OPTION_YES), wasm]) {
      const s = await run([exec(inner)]);
      expect(s.level).toBe('dangerous');
      expect(s.messages[0]?.level).toBe('dangerous');
      expect(s.dangers.length).toBeGreaterThan(0);
    }
  });

  it('keeps a grant dangerous even when its bytes are broken', async () => {
    const broken: AnyMsg = { typeUrl: MsgGrant.typeUrl, value: new Uint8Array([10, 99]) };
    expect((await run([broken])).level).toBe('dangerous');
  });
});

describe('authz exec', () => {
  it('shows the recipient and amount of a wrapped send from your own account', async () => {
    const s = await run([exec(send(STRANGER, [{ denom: 'ubze', amount: '2500000' }]))]);
    expect(s.level).toBe('dangerous');
    expect(s.title).toBe('Send');
    expect(s.hero).toBe('2.50 BZE');
    const stranger = `${STRANGER.slice(0, 8)}…${STRANGER.slice(-6)}`;
    expect(s.sub).toBe(`to ${stranger} · from your own account`);
    expect(s.rows).toEqual([
      ['Runs from', 'Your own account'],
      ['To', STRANGER, 'mono'],
      ['Amount', '2.50 BZE'],
    ]);
    expect(s.dangers[0]?.title).toBe('This runs from your own account');
    expect(s.dangers[0]?.text).toContain('your own address');
  });

  it('shows a wrapped grant from your own account like a top-level grant', async () => {
    const wrapped = pack(MsgGrant, {
      granter: ME,
      grantee: STRANGER,
      grant: {
        authorization: wrap(GenericAuthorization, { msg: '/cosmos.bank.v1beta1.MsgSend' }),
      },
    });
    const s = await run([exec(wrapped)]);
    expect(s.level).toBe('dangerous');
    expect(s.title).toBe('Grant permission');
    expect(s.hero).toBe('Any MsgSend');
    expect(s.rows).toEqual([
      ['Runs from', 'Your own account'],
      ['Grantee', STRANGER, 'mono'],
      ['Permission', 'Any MsgSend'],
      ['Expires', 'Never'],
    ]);
    expect(s.dangers.map((d) => d.title)).toEqual([
      'This runs from your own account',
      `This gives ${STRANGER.slice(0, 8)}…${STRANGER.slice(-6)} power over your address`,
    ]);
  });

  it('names the granter whose permission a wrapped message uses', async () => {
    const theirs = pack(MsgSend, {
      fromAddress: ALEX,
      toAddress: STRANGER,
      amount: [{ denom: 'ubze', amount: '1000000' }],
    });
    const s = await run([exec(theirs)]);
    expect(s.level).toBe('dangerous');
    expect(s.hero).toBe('1.00 BZE');
    expect(s.sub).toContain('on behalf of Alex');
    expect(s.rows[0]).toEqual(['Runs from', ALEX, 'mono']);
    expect(s.rows).toContainEqual(['To', STRANGER, 'mono']);
    expect(s.dangers[0]?.title).toBe('This runs on behalf of Alex');
    expect(s.dangers[0]?.text).not.toContain('your own address');
  });

  it('marks the account of each wrapped message when they mix accounts', async () => {
    const theirs = pack(MsgSend, {
      fromAddress: ALEX,
      toAddress: ME,
      amount: [{ denom: 'ubze', amount: '1000000' }],
    });
    const s = await run([exec(theirs, send(STRANGER))]);
    expect(s.level).toBe('dangerous');
    expect(s.title).toBe('2 messages');
    const me = `${ME.slice(0, 8)}…${ME.slice(-6)}`;
    expect(s.rows).toContainEqual(['Message 1', `Send · 1.00 BZE · to ${me}`]);
    expect(s.rows).toContainEqual(['Runs from', ALEX, 'mono']);
    expect(s.rows).toContainEqual(['Runs from', 'Your own account']);
    expect(s.rows).toContainEqual(['To', STRANGER, 'mono']);
    expect(s.dangers[0]?.title).toBe('Some of these run from your own account');
  });

  it('lists how many wrapped messages it does not show', async () => {
    const many = Array.from({ length: 12 }, () => send(STRANGER));
    const s = await run([exec(...many)]);
    expect(s.rows.filter((r) => r[0].startsWith('Message '))).toHaveLength(10);
    expect(s.rows[s.rows.length - 1]).toEqual(['…', '2 more messages']);
    expect(s.level).toBe('dangerous');
  });

  it('reports a wrapped message of an unknown type or with broken bytes', async () => {
    const unknown = await run([exec(wasm)]);
    expect(unknown.level).toBe('dangerous');
    expect(unknown.hero).toBe('Unknown message');
    expect(unknown.rows[0]).toEqual(['Runs from', 'An account the wallet cannot read']);
    const brokenSend: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    const broken = await run([exec(brokenSend)]);
    expect(broken.level).toBe('dangerous');
    expect(broken.sub).toContain('unreadable');
    expect(broken.rows[0]).toEqual(['Runs from', 'An account the wallet cannot read']);
  });

  it.each<[string, AnyMsg]>([
    [
      'an IBC transfer',
      pack(MsgTransfer, {
        sourcePort: 'transfer',
        sourceChannel: 'channel-3',
        token: { denom: 'ubze', amount: '1000000' },
        sender: ME,
        receiver: STRANGER,
      }),
    ],
    [
      'a delegation',
      pack(MsgDelegate, {
        delegatorAddress: ME,
        validatorAddress: STRANGER,
        amount: { denom: 'ubze', amount: '1000000' },
      }),
    ],
    ['an order', order('buy')],
    ['a new token', pack(factory.MsgCreateDenom, { creator: ME, subdenom: 'coin' })],
    [
      'a fee grant',
      pack(MsgGrantAllowance, {
        granter: ME,
        grantee: STRANGER,
        allowance: wrap(BasicAllowance, { spendLimit: [] }),
      }),
    ],
    [
      'a multi-send with one input',
      pack(MsgMultiSend, {
        inputs: [{ address: ME, coins: [{ denom: 'ubze', amount: '1000000' }] }],
        outputs: [{ address: STRANGER, coins: [{ denom: 'ubze', amount: '1000000' }] }],
      }),
    ],
  ])('says %s wrapped from your own account runs from it', async (_, inner) => {
    const s = await run([exec(inner)]);
    expect(s.level).toBe('dangerous');
    expect(s.rows[0]).toEqual(['Runs from', 'Your own account']);
    expect(s.dangers[0]?.title).toBe('This runs from your own account');
  });

  it('reads your own address written in upper case as your own account', async () => {
    const s = await run([exec(pack(MsgSend, { fromAddress: ME.toUpperCase(), toAddress: ALEX }))]);
    expect(s.rows[0]).toEqual(['Runs from', 'Your own account']);
    expect(s.dangers[0]?.title).toBe('This runs from your own account');
  });

  it.each<[string, AnyMsg]>([
    [
      'an address of another chain with your bytes',
      pack(MsgSend, {
        fromAddress: bech32.encode('cosmos', bech32.decode(ME as `${string}1${string}`).words),
        toAddress: ALEX,
      }),
    ],
    ['an empty signer', pack(MsgSend, { fromAddress: '', toAddress: ALEX })],
    ['an invalid address', pack(MsgSend, { fromAddress: 'bze1nope', toAddress: ALEX })],
    [
      'two signers',
      pack(MsgMultiSend, {
        inputs: [
          { address: ME, coins: [{ denom: 'ubze', amount: '1' }] },
          { address: ALEX, coins: [{ denom: 'ubze', amount: '1' }] },
        ],
        outputs: [{ address: STRANGER, coins: [{ denom: 'ubze', amount: '2' }] }],
      }),
    ],
  ])('cannot read the account of %s', async (_, inner) => {
    const s = await run([exec(inner)]);
    expect(s.level).toBe('dangerous');
    expect(s.rows[0]).toEqual(['Runs from', 'An account the wallet cannot read']);
    expect(s.sub).toContain('from an account the wallet cannot read');
    expect(JSON.stringify(s)).not.toContain('on behalf of');
  });

  it('stays dangerous with no wrapped messages', async () => {
    const s = await run([exec()]);
    expect(s.level).toBe('dangerous');
    expect(s.dangers.length).toBeGreaterThan(0);
  });

  it('reads the account of a nested exec from its grantee', async () => {
    const theirs = await run([
      exec(pack(MsgExec, { grantee: ALEX, msgs: [Any.fromPartial(send(STRANGER))] })),
    ]);
    expect(theirs.rows[0]).toEqual(['Runs from', ALEX, 'mono']);
    const mine = await run([exec(exec(send(STRANGER)))]);
    expect(mine.rows[0]).toEqual(['Runs from', 'Your own account']);
  });

  it('keeps every red box in a batch that holds an exec', async () => {
    const s = await run([send(), exec(selfGrant())]);
    expect(s.level).toBe('dangerous');
    expect(s.dangers.map((d) => d.title)).toEqual([
      'This runs from your own account',
      `This gives ${short(STRANGER)} power over your address`,
    ]);
  });

  it("keeps a wrapped grant's red box next to another granter's message", async () => {
    const theirs = pack(MsgSend, {
      fromAddress: ALEX,
      toAddress: STRANGER,
      amount: [{ denom: 'ubze', amount: '1000000' }],
    });
    const s = await run([exec(theirs, selfGrant())]);
    expect(s.rows).toContainEqual(['Runs from', ALEX, 'mono']);
    expect(s.dangers.map((d) => d.title)).toEqual([
      'Some of these run from your own account',
      `This gives ${short(STRANGER)} power over your address`,
    ]);
  });

  it('keeps an exec with broken bytes dangerous', async () => {
    const broken: AnyMsg = { typeUrl: MsgExec.typeUrl, value: new Uint8Array([10, 99]) };
    expect((await run([broken])).level).toBe('dangerous');
  });

  describe('past the rows it shows', () => {
    const theirs = pack(MsgSend, {
      fromAddress: ALEX,
      toAddress: STRANGER,
      amount: [{ denom: 'ubze', amount: '1' }],
    });
    const harmless = Array.from({ length: 10 }, () => theirs);
    const titles = (s: TxSummary) => s.dangers.map((d) => d.title);

    it('warns about a hidden nested exec', async () => {
      const nested = pack(MsgExec, { grantee: ALEX, msgs: [Any.fromPartial(theirs)] });
      const s = await run([exec(...harmless, nested)]);
      expect(titles(s)).toContain('1 message not shown here needs a closer look');
    });

    it('warns about a hidden admin hand-over from your own account', async () => {
      const handOver = pack(factory.MsgChangeAdmin, {
        creator: ME,
        denom: VDL,
        newAdmin: STRANGER,
      });
      const s = await run([exec(...harmless, handOver)]);
      expect(titles(s)[1]).toBe('1 message not shown here needs a closer look');
    });

    it('keeps the red boxes of many wrapped messages few', async () => {
      const handOver = pack(factory.MsgChangeAdmin, {
        creator: ME,
        denom: VDL,
        newAdmin: STRANGER,
      });
      const s = await run([exec(...Array.from({ length: 50 }, () => handOver))]);
      expect(titles(s)[1]).toBe('40 messages not shown here need a closer look');
      expect(new Set(titles(s)).size).toBe(titles(s).length);
      expect(s.dangers.length).toBeLessThanOrEqual(3);
    });

    it('warns about hidden messages it cannot read', async () => {
      const brokenSend: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
      const s = await run([exec(...harmless, wasm, brokenSend)]);
      expect(titles(s)).toContain('2 messages not shown here need a closer look');
    });

    it('stays quiet about hidden ordinary messages of other accounts', async () => {
      const s = await run([exec(...harmless, theirs, theirs)]);
      expect(titles(s)).toEqual(['This runs messages on behalf of other accounts']);
    });
  });

  it('shows the good messages around one it cannot read', async () => {
    const brokenSend: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    const theirs = pack(MsgSend, {
      fromAddress: ALEX,
      toAddress: STRANGER,
      amount: [{ denom: 'ubze', amount: '1000000' }],
    });
    const s = await run([exec(send(STRANGER), brokenSend, theirs)]);
    expect(s.level).toBe('dangerous');
    expect(s.rows).toContainEqual(['To', STRANGER, 'mono']);
    expect(s.rows).toContainEqual(['Runs from', ALEX, 'mono']);
    expect(s.rows).toContainEqual(['Runs from', 'An account the wallet cannot read']);
    expect(s.dangers[0]?.title).toBe('Some of these run from your own account');
  });

  it('says messages it cannot read may run from your own account', async () => {
    const theirs = pack(MsgSend, { fromAddress: ALEX, toAddress: STRANGER });
    const s = await run([exec(theirs, wasm)]);
    expect(s.dangers[0]?.title).toBe('Some of these may run from your own account');
    const one = await run([exec(wasm)]);
    expect(one.dangers[0]?.text).toContain('it may be your own');
  });

  it('numbers the messages of a nested exec under their parent', async () => {
    const inner = pack(MsgExec, {
      grantee: ME,
      msgs: [Any.fromPartial(send(STRANGER)), Any.fromPartial(send(ALEX))],
    });
    const s = await run([exec(send(ALEX), inner)]);
    const labels = s.rows.map((r) => r[0]).filter((l) => l.startsWith('Message '));
    expect(labels).toEqual(['Message 1', 'Message 2', 'Message 2.1', 'Message 2.2']);
  });

  it('does not decode an exec past the depth limit', async () => {
    const s = await run([exec(exec(exec(send(STRANGER))))]);
    expect(s.level).toBe('dangerous');
    expect(s.rows).toEqual([
      ['Runs from', 'Your own account'],
      ['Runs from', 'An account the wallet cannot read'],
    ]);
    expect(JSON.stringify(s)).toContain('Nested too deeply to read');
    const text = JSON.stringify(s).replaceAll('"unreadable":false', '');
    expect(text.toLowerCase()).not.toContain('unreadable');
  });

  it('shows an over-long signer as unreadable and never in full', async () => {
    const long = `bze1${'q'.repeat(200)}`;
    const s = await run([exec(pack(MsgSend, { fromAddress: long, toAddress: ALEX }))]);
    expect(s.rows[0]).toEqual(['Runs from', 'An account the wallet cannot read']);
    for (const [, value] of s.rows) expect(value.length).toBeLessThanOrEqual(81);
    expect(JSON.stringify(s)).not.toContain(long);
  });

  it('reads a nested exec grantee in upper case as your own account', async () => {
    const nested = pack(MsgExec, { grantee: ME.toUpperCase(), msgs: [Any.fromPartial(send())] });
    const s = await run([exec(nested)]);
    expect(s.rows[0]).toEqual(['Runs from', 'Your own account']);
  });

  it('still warns about wrapped messages past the rows it shows', async () => {
    const theirs = pack(MsgSend, {
      fromAddress: ALEX,
      toAddress: STRANGER,
      amount: [{ denom: 'ubze', amount: '1' }],
    });
    const harmless = Array.from({ length: 10 }, () => theirs);
    const s = await run([exec(...harmless, send(STRANGER), selfGrant())]);
    expect(s.rows[s.rows.length - 1]).toEqual(['…', '2 more messages']);
    expect(JSON.stringify(s.rows)).not.toContain('Your own account');
    const titles = s.dangers.map((d) => d.title);
    expect(titles[0]).toBe('Some of these run from your own account');
    expect(titles[1]).toBe('2 messages not shown here need a closer look');
  });

  it('does not read nesting past its depth limit', async () => {
    const deep = exec(
      pack(MsgExec, {
        grantee: ME,
        msgs: [Any.fromPartial(exec(send(STRANGER)))],
      }),
    );
    const s = await run([deep]);
    expect(s.level).toBe('dangerous');
    expect(JSON.stringify(s)).not.toContain(STRANGER.slice(-6));
    expect(JSON.stringify(s)).toContain('Nested too deeply to read');
    const shallow = await run([exec(exec(send(STRANGER)))]);
    expect(shallow.rows).toContainEqual(['To', STRANGER, 'mono']);
  });
});

describe('unknown messages', () => {
  it('shows the last segment of the type url and nothing else', async () => {
    const s = await run([wasm]);
    expect(s.level).toBe('unknown');
    expect(s.title).toBe('MsgExecuteContract');
    expect(s.hero).toBe('Unknown message');
    expect(s.sub).toBe('/cosmwasm.wasm.v1.MsgExecuteContract');
    expect(s.rows).toEqual([]);
    expect(s.messages[0]).toMatchObject({ level: 'unknown', icon: 'unknown' });
  });

  it('treats a known type with unreadable bytes as unknown', async () => {
    const broken: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    const s = await run([broken]);
    expect(s.level).toBe('unknown');
    expect(s.sub).toContain('unreadable');
  });
});

describe('the trust tick', () => {
  it('is needed for a message the wallet cannot read, alone or next to a readable one', async () => {
    expect(needsTrust(await run([wasm]))).toBe(true);
    expect(needsTrust(await run([send(), wasm]))).toBe(true);
    expect(needsTrust(await run([wasm, send()]))).toBe(true);
  });

  it('is needed for a known type whose bytes do not decode', async () => {
    const broken: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    expect(needsTrust(await run([broken]))).toBe(true);
  });

  it('is needed for a dangerous request, and for an exec of a message it cannot read', async () => {
    expect(needsTrust(await run([exec(send(STRANGER))]))).toBe(true);
    expect(needsTrust(await run([exec(wasm)]))).toBe(true);
    expect(needsTrust(await run([exec(send(), wasm)]))).toBe(true);
  });

  it('is not needed for a readable message, even one it could not verify', async () => {
    expect(needsTrust(await run([send()]))).toBe(false);
    const unverified = await run([swap(['pool-nowhere'], 'ubze', USDC)]);
    expect(unverified.level).toBe('unknown');
    expect(needsTrust(unverified)).toBe(false);
    expect(needsTrust(await run([send(), swap([])]))).toBe(false);
  });

  it('is not needed for a governance-only type: the request checks refuse those', async () => {
    const s = await run([{ typeUrl: '/bze.tradebin.MsgUpdatePools', value: new Uint8Array() }]);
    expect(needsTrust(s)).toBe(false);
  });
});

describe('several messages', () => {
  it('shares the market pair when every message acts on one market', async () => {
    const s = await run([order('buy', '1000000', '0.3'), order('sell', '1000000', '0.4')]);
    expect(s.title).toBe('2 messages');
    expect(s.hero).toBe('Signed together');
    expect(s.sub).toBe('BZE/USDC · both happen, or neither does');
    expect(s.rows).toEqual([]);
    expect(s.messages.map((m) => m.title)).toEqual(['Buy order', 'Sell order']);
    expect(s.messages[0]?.line).toBe('1.00 BZE · BZE/USDC at 0.3000 USDC');
  });

  it('gives every message its own hero, sub and rows', async () => {
    const single = await run([order('buy', '1000000', '0.3')]);
    const both = await run([order('buy', '1000000', '0.3'), grant()]);
    const [first, second] = both.messages;
    expect(first).toMatchObject({ hero: single.hero, sub: single.sub, rows: single.rows });
    expect(first?.rows.length).toBeGreaterThan(0);
    expect(second?.hero).toContain('Any MsgSend');
    expect(second?.rows).toContainEqual(['Grantee', ALEX, 'mono']);
  });

  it('has no shared line for different markets, or messages without a market', async () => {
    const other = await run([order('buy'), order('buy', '5', '1', VDL_BZE.id)]);
    expect(other.sub).toBe('All happen, or none does');
    const mixed = await run([order('buy'), send()]);
    expect(mixed.sub).toBe('All happen, or none does');
    expect((await run([send(), send()])).sub).toBe('All happen, or none does');
  });

  it('does not claim a shared market when it cannot name it', async () => {
    const s = await run([order('buy', '1', '1', 'nope'), order('buy', '1', '1', 'nope')]);
    expect(s.sub).toBe('All happen, or none does');
  });

  it('takes the riskiest level: dangerous over unknown over normal', async () => {
    expect((await run([send(), send()])).level).toBe('normal');
    expect((await run([send(), wasm])).level).toBe('unknown');
    expect((await run([send(), wasm, grant()])).level).toBe('dangerous');
    expect((await run([grant(), send()])).level).toBe('dangerous');
    expect((await run([wasm, send()])).level).toBe('unknown');
  });

  it('collects every red-box text', async () => {
    const s = await run([grant(), send()]);
    expect(s.dangers).toHaveLength(1);
    expect(s.messages[0]?.danger).not.toBeNull();
    expect(s.messages[1]?.danger).toBeNull();
  });
});

describe('failing lookups', () => {
  const down = () => Promise.reject(new Error('node down'));

  it('never throws and falls back to ids and base units', async () => {
    const ctx = context({
      tokens: { resolve: down },
      markets: { markets: down, liquidityPools: down },
      orders: { marketOrder: down },
    });
    const all = [
      send(),
      swap(),
      order('sell'),
      pack(MsgCancelOrder, { creator: ME, marketId: BZE_USDC.id, orderId: '1', orderType: 'buy' }),
      pack(MsgAddLiquidity, {
        creator: ME,
        poolId: 'p',
        baseAmount: '1',
        quoteAmount: '2',
        minLpTokens: '1',
      }),
      pack(MsgJoinRaffle, { creator: ME, denom: VDL, tickets: 2n }),
    ];
    const s = await summarise(all, ctx);
    expect(s.messages).toHaveLength(6);
    // Without its pools the swap's route can't be proven, so the request is not plain normal.
    expect(s.messages[1]?.level).toBe('unknown');
    expect(s.level).toBe('unknown');
    expect(s.messages[0]?.line).toContain('1,000,000,000 ubze (base units)');
  });

  it('asks for markets and pools once per summary', async () => {
    const markets = vi.fn().mockResolvedValue(MARKETS);
    const liquidityPools = vi.fn().mockResolvedValue(POOLS);
    await run([order('buy'), order('sell'), swap(), swap()], {
      markets: { markets, liquidityPools },
    });
    expect(markets).toHaveBeenCalledTimes(1);
    expect(liquidityPools).toHaveBeenCalledTimes(1);
  });

  it('shows a denom a resolver refuses without invisible characters', async () => {
    const weird = 'ubze‮';
    const s = await run([send(ALEX, [{ denom: weird, amount: '1' }])]);
    expect(s.hero).not.toMatch(/‮/);
  });
});

describe('many tokens in one request', () => {
  /** The most distinct tokens one summary looks up; BZE comes on top. */
  const MAX_LOOKUPS = 32;

  it('looks up a bounded number of tokens, shows the rest in base units, and always knows BZE', async () => {
    const resolve = vi.fn((denom: string) =>
      Promise.resolve({
        denom,
        symbol: denom === 'ubze' ? 'BZE' : 'TKN',
        name: 'Token',
        decimals: 6,
        kind: 'factory' as const,
        source: 'chain' as const,
        branding: null,
        logo: null,
      }),
    );
    const spendLimit = Array.from({ length: 200 }, (_, i) => ({
      denom: `factory/${ME}/u${String(i)}`,
      amount: '1000000',
    }));
    spendLimit.push({ denom: 'ubze', amount: '1000000' });
    const many = pack(MsgGrant, {
      granter: ME,
      grantee: STRANGER,
      grant: { authorization: wrap(SendAuthorization, { spendLimit, allowList: [] }) },
    });
    const s = await run([many], { tokens: { resolve } });
    const asked = new Set(resolve.mock.calls.map(([denom]) => denom));
    expect(asked.size).toBeLessThanOrEqual(MAX_LOOKUPS + 1);
    expect(asked.has('ubze')).toBe(true);
    const permission = s.rows.find((r) => r[0] === 'Permission')?.[1] ?? '';
    expect(permission).toContain('1.00 TKN');
    expect(permission).toContain('(base units)');
    expect(permission).toContain('1.00 BZE');
  });
});

describe('rawJson', () => {
  it('pretty-prints decoded messages, expiry included', () => {
    const json = rawJson([send(), grant(new Date('2027-03-04T05:06:07Z'))]);
    const parsed = JSON.parse(json) as { typeUrl: string; value: Record<string, unknown> }[];
    expect(parsed.map((m) => m.typeUrl)).toEqual([MsgSend.typeUrl, MsgGrant.typeUrl]);
    expect(json).toContain('\n  ');
    expect(json).toContain('2027-03-04T05:06:07.000Z');
  });

  it('keeps the bytes of a message it cannot decode', () => {
    const parsed = JSON.parse(rawJson([wasm])) as unknown;
    expect(parsed).toEqual([{ typeUrl: wasm.typeUrl, unknown: true, value: 'AQID' }]);
  });

  it('shows bytes that do not decode as their type', () => {
    const broken: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    expect(JSON.parse(rawJson([broken]))).toEqual([
      { typeUrl: MsgSend.typeUrl, unknown: true, value: 'CmM=' },
    ]);
  });
});

/** Every string inside a value, concatenated: JSON escapes would hide control characters. */
function allStrings(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(allStrings).join('\n');
  if (typeof value === 'object' && value !== null)
    return Object.entries(value)
      .map(([k, v]) => k + '\n' + allStrings(v))
      .join('\n');
  return '';
}

const INVISIBLE: [string, string][] = [
  ['bidi override', '\u202e'],
  ['bidi isolate', '\u2066'],
  ['zero-width space', '\u200b'],
  ['zero-width joiner', '\u200d'],
  ['word joiner', '\u2060'],
  ['soft hyphen', '\u00ad'],
  ['byte order mark', '\ufeff'],
  ['tag character', '\u{e0041}'],
  ['private use', '\ue000'],
  ['line separator', '\u2028'],
  ['null', '\u0000'],
  ['escape', '\u001b'],
];

describe('invisible characters', () => {
  it.each(INVISIBLE)('%s is never passed through to the user', async (_name, char) => {
    const text = `a${char}b`;
    const unknownType: AnyMsg = { typeUrl: `/x.v1.Msg${char}Evil`, value: new Uint8Array() };
    const s = await run([
      unknownType,
      send(`bze1${char}x`, [{ denom: `ub${char}ze`, amount: '1' }]),
    ]);
    const shown = allStrings(s);
    expect(shown).not.toContain(char);
    expect(shown).toContain('\uFFFD');

    const memo = (await run([send()], {}, text)).memo;
    expect(memo).toBe('a\uFFFDb');
  });

  it('is also stripped from token symbols', async () => {
    const tokens = {
      resolve: () =>
        Promise.resolve({
          denom: 'ubze',
          symbol: 'U\u200bSDC',
          name: 'x',
          decimals: 6,
          kind: 'native' as const,
          source: 'chain' as const,
          branding: null,
          logo: null,
        }),
    };
    const s = await run([send()], { tokens });
    expect(s.hero).toBe('1,000.00 U\uFFFDSDC');
  });

  it.each(INVISIBLE)('%s is neutralised in the raw JSON too', (_name, char) => {
    const unknownType: AnyMsg = { typeUrl: `/x.v1.Msg${char}Evil`, value: new Uint8Array([1]) };
    const memoMsg = pack(MsgSend, {
      fromAddress: ME,
      toAddress: `bze1${char}x`,
      amount: [{ denom: `ub${char}ze`, amount: '1' }],
    });
    const shown = allStrings(JSON.parse(rawJson([unknownType, memoMsg])));
    expect(shown).not.toContain(char);
    expect(shown).toContain('\uFFFD');
  });
});

describe('memo', () => {
  const memoOf = async (memo?: string) =>
    (await summarise([send()], context(), memo === undefined ? {} : { memo })).memo;

  it('is null when there is none or it is blank', async () => {
    expect(await memoOf()).toBeNull();
    expect(await memoOf('')).toBeNull();
    expect(await memoOf('  \n\t ')).toBeNull();
  });

  it('is shown as one trimmed line', async () => {
    expect(await memoOf('  thanks\nfor   lunch ')).toBe('thanks for lunch');
  });

  it('is cut with a visible marker when long, and not when it fits', async () => {
    const fits = 'x'.repeat(200);
    expect(await memoOf(fits)).toBe(fits);
    const long = await memoOf('x'.repeat(201));
    expect(long).toBe(`${'x'.repeat(200)}… (truncated)`);
    expect(await memoOf('😀'.repeat(300))).toBe(`${'😀'.repeat(200)}… (truncated)`);
  });

  it('is untrusted text: invisible characters are replaced', async () => {
    expect(await memoOf('pay\u202e now')).toBe('pay\uFFFD now');
  });

  it('is part of a multi-message summary too', async () => {
    const s = await summarise([send(), send()], context(), { memo: 'both' });
    expect(s.memo).toBe('both');
  });
});

const VALOPER = 'bzevaloper1q8t5x0yvl9jzx5pq4m3vvrmkz8cndhqk7g2uxy';
const VALOPER2 = 'bzevaloper1vtad8680vhdfqvxx0f2yaxa6agdylelmh5r3ql';
const NOBLE = 'noble1r5v5srda7xfth3hn2s26txvrcrntldjuh9m7ad';
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
const bze = (amount: string) => ({ denom: 'ubze', amount });

/** One realistic sample of every BZE and cosmos/ibc type the wallet summarises. */
const SAMPLES: Record<string, AnyMsg> = {
  [MsgCreateMarket.typeUrl]: pack(MsgCreateMarket, { creator: ME, base: VDL, quote: 'ubze' }),
  [MsgCreateLiquidityPool.typeUrl]: pack(MsgCreateLiquidityPool, {
    creator: ME,
    base: VDL,
    quote: 'ubze',
    fee: '0.003',
    initialBase: '1000000000',
    initialQuote: '500000000',
  }),
  [rewards.MsgJoinStaking.typeUrl]: pack(rewards.MsgJoinStaking, {
    creator: ME,
    rewardId: '7',
    amount: '500000000',
  }),
  [rewards.MsgExitStaking.typeUrl]: pack(rewards.MsgExitStaking, { creator: ME, rewardId: '7' }),
  [rewards.MsgClaimStakingRewards.typeUrl]: pack(rewards.MsgClaimStakingRewards, {
    creator: ME,
    rewardId: '7',
  }),
  [rewards.MsgCreateStakingReward.typeUrl]: pack(rewards.MsgCreateStakingReward, {
    creator: ME,
    prizeAmount: '1000000',
    prizeDenom: VDL,
    stakingDenom: 'ubze',
    duration: '30',
    minStake: '0',
    lock: '1',
  }),
  [rewards.MsgUpdateStakingReward.typeUrl]: pack(rewards.MsgUpdateStakingReward, {
    creator: ME,
    rewardId: '7',
    duration: '10',
  }),
  [rewards.MsgDeleteStakingReward.typeUrl]: pack(rewards.MsgDeleteStakingReward, {
    creator: ME,
    rewardId: '7',
  }),
  [rewards.MsgDistributeStakingRewards.typeUrl]: pack(rewards.MsgDistributeStakingRewards, {
    creator: ME,
    rewardId: '7',
    amount: '5000',
  }),
  [rewards.MsgCreateTradingReward.typeUrl]: pack(rewards.MsgCreateTradingReward, {
    creator: ME,
    prizeAmount: '2000000',
    prizeDenom: 'ubze',
    duration: '7',
    marketId: BZE_USDC.id,
    slots: '3',
  }),
  [rewards.MsgActivateTradingReward.typeUrl]: pack(rewards.MsgActivateTradingReward, {
    creator: ME,
    rewardId: '4',
  }),
  [rewards.MsgCreateDenomReward.typeUrl]: pack(rewards.MsgCreateDenomReward, {
    creator: ME,
    denom: VDL,
  }),
  [rewards.MsgJoinDenomReward.typeUrl]: pack(rewards.MsgJoinDenomReward, {
    creator: ME,
    denom: VDL,
    amount: '500000000',
  }),
  [rewards.MsgExitDenomReward.typeUrl]: pack(rewards.MsgExitDenomReward, {
    creator: ME,
    denom: VDL,
  }),
  [rewards.MsgClaimDenomRewards.typeUrl]: pack(rewards.MsgClaimDenomRewards, {
    creator: ME,
    denom: VDL,
  }),
  [rewards.MsgCreateDenomRewardSchedule.typeUrl]: pack(rewards.MsgCreateDenomRewardSchedule, {
    creator: ME,
    denom: VDL,
    prizeDenom: 'ubze',
    dailyAmount: '1000000',
    duration: '30',
  }),
  [rewards.MsgUpdateDenomRewardSchedule.typeUrl]: pack(rewards.MsgUpdateDenomRewardSchedule, {
    creator: ME,
    denom: VDL,
    scheduleId: '2',
    duration: '5',
  }),
  [rewards.MsgDistributeDenomRewards.typeUrl]: pack(rewards.MsgDistributeDenomRewards, {
    creator: ME,
    denom: VDL,
    prizeDenom: 'ubze',
    amount: '1000000000',
  }),
  [factory.MsgCreateDenom.typeUrl]: pack(factory.MsgCreateDenom, { creator: ME, subdenom: 'uvdl' }),
  [factory.MsgMint.typeUrl]: pack(factory.MsgMint, { creator: ME, coins: `10000000000${VDL}` }),
  [factory.MsgBurn.typeUrl]: pack(factory.MsgBurn, { creator: ME, coins: `1000000${VDL}` }),
  [factory.MsgChangeAdmin.typeUrl]: pack(factory.MsgChangeAdmin, {
    creator: ME,
    denom: VDL,
    newAdmin: ALEX,
  }),
  [factory.MsgSetDenomMetadata.typeUrl]: pack(factory.MsgSetDenomMetadata, {
    creator: ME,
    metadata: {
      base: VDL,
      display: 'VDL',
      name: 'Vidulum',
      symbol: 'VDL',
      description: 'The Vidulum token',
      denomUnits: [
        { denom: VDL, exponent: 0, aliases: [] },
        { denom: 'VDL', exponent: 6, aliases: [] },
      ],
      uri: '',
      uriHash: '',
    },
  }),
  [factory.MsgSetDenomBranding.typeUrl]: pack(factory.MsgSetDenomBranding, {
    creator: ME,
    denom: VDL,
    branding: {
      font: 'Inter',
      light: { background: '#ffffff', text: '#000000', primary: '#f5b800', secondary: '#1a1a1a' },
    },
  }),
  [MsgStartRaffle.typeUrl]: pack(MsgStartRaffle, {
    creator: ME,
    pot: '1000000000',
    duration: '7',
    chances: '100',
    ratio: '0.5',
    ticketPrice: '1000000',
    denom: VDL,
  }),
  [MsgMoveIbcLockedCoins.typeUrl]: pack(MsgMoveIbcLockedCoins, { creator: ME, denom: USDC }),
  [MsgAddArticle.typeUrl]: pack(MsgAddArticle, {
    publisher: ME,
    title: 'BZE ships v8.2',
    url: 'https://news.example/bze-v8-2',
    picture: 'https://news.example/cover.png',
  }),
  [MsgPayPublisherRespect.typeUrl]: pack(MsgPayPublisherRespect, {
    creator: ME,
    address: ALEX,
    amount: '100000000ubze',
  }),
  [MsgMultiSend.typeUrl]: pack(MsgMultiSend, {
    inputs: [{ address: ME, coins: [bze('1200000000')] }],
    outputs: [ALEX, STRANGER, ME, NOBLE].map((address) => ({
      address,
      coins: [bze('300000000')],
    })),
  }),
  [MsgCreateVestingAccount.typeUrl]: pack(MsgCreateVestingAccount, {
    fromAddress: ME,
    toAddress: STRANGER,
    amount: [bze('5000000000')],
    endTime: 1_800_000_000n,
    delayed: false,
  }),
  [MsgCreatePermanentLockedAccount.typeUrl]: pack(MsgCreatePermanentLockedAccount, {
    fromAddress: ME,
    toAddress: STRANGER,
    amount: [bze('5000000000')],
  }),
  [MsgCreatePeriodicVestingAccount.typeUrl]: pack(MsgCreatePeriodicVestingAccount, {
    fromAddress: ME,
    toAddress: STRANGER,
    startTime: 1_800_000_000n,
    vestingPeriods: [
      { length: 86_400n, amount: [bze('1000000')] },
      { length: 86_400n, amount: [bze('2000000')] },
    ],
  }),
  [MsgFundCommunityPool.typeUrl]: pack(MsgFundCommunityPool, {
    depositor: ME,
    amount: [bze('2500000')],
  }),
  [MsgDepositValidatorRewardsPool.typeUrl]: pack(MsgDepositValidatorRewardsPool, {
    depositor: ME,
    validatorAddress: VALOPER,
    amount: [bze('1000000')],
  }),
  [MsgDeposit.typeUrl]: pack(MsgDeposit, {
    proposalId: 42n,
    depositor: ME,
    amount: [bze('10000000')],
  }),
  [MsgDelegate.typeUrl]: pack(MsgDelegate, {
    delegatorAddress: ME,
    validatorAddress: VALOPER,
    amount: bze('500000000'),
  }),
  [MsgUndelegate.typeUrl]: pack(MsgUndelegate, {
    delegatorAddress: ME,
    validatorAddress: VALOPER,
    amount: bze('500000000'),
  }),
  [MsgBeginRedelegate.typeUrl]: pack(MsgBeginRedelegate, {
    delegatorAddress: ME,
    validatorSrcAddress: VALOPER,
    validatorDstAddress: VALOPER2,
    amount: bze('500000000'),
  }),
  [MsgCancelUnbondingDelegation.typeUrl]: pack(MsgCancelUnbondingDelegation, {
    delegatorAddress: ME,
    validatorAddress: VALOPER,
    amount: bze('500000000'),
    creationHeight: 21_000_000n,
  }),
  [MsgSetWithdrawAddress.typeUrl]: pack(MsgSetWithdrawAddress, {
    delegatorAddress: ME,
    withdrawAddress: ME2,
  }),
  [MsgWithdrawDelegatorReward.typeUrl]: pack(MsgWithdrawDelegatorReward, {
    delegatorAddress: ME,
    validatorAddress: VALOPER,
  }),
  [MsgTransfer.typeUrl]: pack(MsgTransfer, {
    sourcePort: 'transfer',
    sourceChannel: 'channel-3',
    token: { denom: USDC, amount: '25000000' },
    sender: ME,
    receiver: NOBLE,
    timeoutTimestamp: 1_800_000_000_000_000_000n,
  }),
};

const GOVERNANCE_ONLY: [string, string][] = [
  ['/bze.burner.MsgUpdateParams', 'Update burner settings'],
  ['/bze.cointrunk.MsgUpdateParams', 'Update CoinTrunk settings'],
  ['/bze.rewards.MsgUpdateParams', 'Update rewards settings'],
  ['/bze.tokenfactory.MsgUpdateParams', 'Update token factory settings'],
  ['/bze.tradebin.MsgUpdateParams', 'Update tradebin settings'],
  ['/bze.txfeecollector.MsgUpdateParams', 'Update fee collector settings'],
  ['/bze.tradebin.MsgHaltDenoms', 'Halt trading of tokens'],
  ['/bze.tradebin.MsgUnhaltDenoms', 'Resume trading of tokens'],
  ['/bze.cointrunk.MsgAcceptDomain', 'Change an accepted news domain'],
  ['/bze.cointrunk.MsgSavePublisher', 'Save a CoinTrunk publisher'],
  ['/bze.tokenfactory.MsgSetDenomAdmin', 'Change a token admin'],
  ['/bze.tradebin.MsgUpdatePools', 'Update liquidity pools'],
];

const DANGEROUS = new Set([
  factory.MsgChangeAdmin.typeUrl,
  MsgCreateVestingAccount.typeUrl,
  MsgCreatePermanentLockedAccount.typeUrl,
  MsgCreatePeriodicVestingAccount.typeUrl,
]);

const sample = (typeUrl: string): AnyMsg => {
  const msg = SAMPLES[typeUrl];
  if (!msg) throw new Error(`no sample for ${typeUrl}`);
  return msg;
};

describe('BZE and cosmos message summaries', () => {
  it.each([
    [MsgCreateMarket.typeUrl, 'create', 'Create market · VDL/BZE · a new order book'],
    [
      MsgCreateLiquidityPool.typeUrl,
      'liquidity',
      'Create pool · VDL/BZE · 1,000.00 VDL + 500.00 BZE',
    ],
    [rewards.MsgJoinStaking.typeUrl, 'stake', 'Stake · 500000000 (base units) · in reward 7'],
    [rewards.MsgExitStaking.typeUrl, 'stake', 'Unstake · Your stake · from reward 7'],
    [
      rewards.MsgClaimStakingRewards.typeUrl,
      'rewards',
      'Claim rewards · Your rewards · from reward 7',
    ],
    [
      rewards.MsgCreateStakingReward.typeUrl,
      'rewards',
      'Create staking reward · 30.00 VDL · over 30 days, for BZE stakers',
    ],
    [
      rewards.MsgUpdateStakingReward.typeUrl,
      'rewards',
      'Extend staking reward · Reward 7 · by 10 days',
    ],
    [
      rewards.MsgDeleteStakingReward.typeUrl,
      'rewards',
      'Delete staking reward · Reward 7 · a staking reward you created',
    ],
    [
      rewards.MsgDistributeStakingRewards.typeUrl,
      'rewards',
      'Top up staking reward · 5000 (base units) · reward 7',
    ],
    [
      rewards.MsgCreateTradingReward.typeUrl,
      'rewards',
      'Create trading reward · 6.00 BZE · on BZE/USDC for 7 days',
    ],
    [
      rewards.MsgActivateTradingReward.typeUrl,
      'rewards',
      'Activate trading reward · Reward 4 · starts the trading reward',
    ],
    [
      rewards.MsgCreateDenomReward.typeUrl,
      'rewards',
      'Create holder reward · VDL · rewards for holders who lock it',
    ],
    [rewards.MsgJoinDenomReward.typeUrl, 'stake', 'Lock · 500.00 VDL · for holder rewards'],
    [rewards.MsgExitDenomReward.typeUrl, 'stake', 'Unlock · VDL · from holder rewards'],
    [
      rewards.MsgClaimDenomRewards.typeUrl,
      'rewards',
      'Claim holder rewards · VDL · your rewards for holding it',
    ],
    [
      rewards.MsgCreateDenomRewardSchedule.typeUrl,
      'rewards',
      'Schedule holder rewards · 30.00 BZE · 1.00 BZE a day for 30 days, to VDL holders',
    ],
    [
      rewards.MsgUpdateDenomRewardSchedule.typeUrl,
      'rewards',
      'Extend holder rewards · Schedule 2 · for VDL holders, by 5 days',
    ],
    [
      rewards.MsgDistributeDenomRewards.typeUrl,
      'rewards',
      'Pay holder rewards · 1,000.00 BZE · to VDL holders',
    ],
    [factory.MsgCreateDenom.typeUrl, 'create', 'Create token · uvdl · you become its admin'],
    [factory.MsgMint.typeUrl, 'create', 'Mint · 10,000.00 VDL · new tokens, as token admin'],
    [factory.MsgBurn.typeUrl, 'burn', 'Burn · 1.00 VDL · as token admin'],
    [
      factory.MsgSetDenomMetadata.typeUrl,
      'edit',
      'Set token details · VDL · Vidulum, VDL, 6 decimals',
    ],
    [
      factory.MsgSetDenomBranding.typeUrl,
      'edit',
      'Set brand colours · VDL · colours and font of the token',
    ],
    [MsgStartRaffle.typeUrl, 'raffle', 'Start raffle · VDL raffle · ticket price 1.00 VDL'],
    [MsgMoveIbcLockedCoins.typeUrl, 'burn', 'Move locked IBC coins · USDC · to the burner'],
    [
      MsgAddArticle.typeUrl,
      'article',
      'Publish article · BZE ships v8.2 · https://news.example/bze-v8-2',
    ],
    [MsgPayPublisherRespect.typeUrl, 'send', 'Pay respect · 100.00 BZE · to Alex'],
    [MsgMultiSend.typeUrl, 'send', 'Send · 1,200.00 BZE · to 4 addresses'],
    [MsgDelegate.typeUrl, 'stake', `Delegate · 500.00 BZE · to ${short(VALOPER)}`],
    [MsgUndelegate.typeUrl, 'stake', `Undelegate · 500.00 BZE · from ${short(VALOPER)}`],
    [
      MsgBeginRedelegate.typeUrl,
      'stake',
      `Move stake · 500.00 BZE · ${short(VALOPER)} → ${short(VALOPER2)}`,
    ],
    [
      MsgWithdrawDelegatorReward.typeUrl,
      'rewards',
      `Claim staking rewards · Your rewards · from ${short(VALOPER)}`,
    ],
    [
      MsgCancelUnbondingDelegation.typeUrl,
      'stake',
      `Cancel unstaking · 500.00 BZE · back to ${short(VALOPER)}`,
    ],
    [
      MsgSetWithdrawAddress.typeUrl,
      'rewards',
      `Change rewards address · ${ME2} · Your future staking rewards go there`,
    ],
    [
      MsgTransfer.typeUrl,
      'send',
      `Send · 25.00 USDC · to ${short(NOBLE)} on another chain · channel-3`,
    ],
  ])('summarises %s', async (typeUrl, icon, line) => {
    const s = await run([sample(typeUrl)]);
    expect(headline(s)).toBe(line);
    expect(s.level).toBe('normal');
    expect(s.messages[0]?.icon).toBe(icon);
  });

  it.each(GOVERNANCE_ONLY)('gives %s one governance line', async (typeUrl, action) => {
    // The bytes are not read: these are signed by the gov module, not by a wallet user.
    const s = await run([{ typeUrl, value: new Uint8Array([1, 2, 3]) }]);
    expect(headline(s)).toBe(`Governance · ${action} · governance`);
    expect(s.level).toBe('normal');
    expect(s.messages[0]?.icon).toBe('settings');
  });

  it('never falls back to "unknown" for any BZE or cosmos/ibc type it summarises', async () => {
    const all: AnyMsg[] = [
      ...Object.values(SAMPLES),
      ...GOVERNANCE_ONLY.map(([typeUrl]) => ({ typeUrl, value: new Uint8Array() })),
    ];
    expect(Object.keys(SAMPLES)).toHaveLength(42);
    const s = await run(all);
    for (const [i, m] of s.messages.entries()) {
      const typeUrl = all[i]?.typeUrl ?? '';
      expect(m.icon, typeUrl).not.toBe('unknown');
      expect(m.hero, typeUrl).not.toBe('Unknown message');
      expect(m.title, typeUrl).not.toBe(typeUrl.split('.').pop());
      // Handing a token's admin or coins in a vesting account to another address is dangerous.
      expect(m.level, typeUrl).toBe(DANGEROUS.has(typeUrl) ? 'dangerous' : 'normal');
      expect(m.unreadable, typeUrl).toBe(false);
    }
    expect(s.level).toBe('dangerous');
  });

  it('shows what a staking reward costs in total and per day', async () => {
    const s = await run([sample(rewards.MsgCreateStakingReward.typeUrl)]);
    expect(s.rows).toEqual([
      ['Prize per day', '1.00 VDL'],
      ['Duration', '30 days'],
      ['Staked token', 'BZE'],
      ['Minimum stake', '0.00 BZE'],
      ['Lock after unstaking', '1 day'],
      ['You pay', "30.00 VDL + the chain's creation fee"],
    ]);
  });

  it("never shows a reward total without the chain's creation fee", async () => {
    for (const typeUrl of [
      rewards.MsgCreateStakingReward.typeUrl,
      rewards.MsgCreateTradingReward.typeUrl,
      rewards.MsgCreateDenomRewardSchedule.typeUrl,
    ]) {
      const s = await run([sample(typeUrl)]);
      const pay = s.rows.find(([label]) => label === 'You pay');
      expect(pay?.[1], typeUrl).toMatch(/ \+ the chain's creation fee$/);
    }
  });

  it("makes handing a token's admin to another address dangerous", async () => {
    const s = await run([sample(factory.MsgChangeAdmin.typeUrl)]);
    expect(headline(s)).toBe('Hand over admin · VDL · to Alex');
    expect(s.level).toBe('dangerous');
    expect(s.messages[0]?.icon).toBe('admin');
    expect(s.dangers).toEqual([
      {
        title: 'This gives Alex control of VDL',
        text: "They can change VDL and pass it on. You can't undo this.",
      },
    ]);
  });

  it('says extending a reward costs more, without a number it cannot know', async () => {
    const staking = await run([sample(rewards.MsgUpdateStakingReward.typeUrl)]);
    expect(staking.rows).toContainEqual(['Cost', "The reward's daily prize × 10 days"]);
    const holders = await run([sample(rewards.MsgUpdateDenomRewardSchedule.typeUrl)]);
    expect(holders.rows).toContainEqual(['Cost', "The schedule's daily amount × 5 days"]);
  });

  it('says giving up a token admin stops minting, and stays normal', async () => {
    const s = await run([pack(factory.MsgChangeAdmin, { creator: ME, denom: VDL, newAdmin: '' })]);
    expect(headline(s)).toBe('Give up admin · VDL · no one can mint it or change it after this');
    expect(s.level).toBe('normal');
  });

  it('shows the memo of an IBC transfer', async () => {
    const memo = '{"forward":{"receiver":"osmo1abc","channel":"channel-0"}}';
    const s = await run([
      pack(MsgTransfer, {
        sourcePort: 'transfer',
        sourceChannel: 'channel-3',
        token: { denom: USDC, amount: '25000000' },
        sender: ME,
        receiver: NOBLE,
        memo,
      }),
    ]);
    expect(s.rows).toContainEqual(['Memo', memo]);
  });

  it('bounds an article title and strips invisible characters from it', async () => {
    const title = `Big\u202Enews ${'x'.repeat(300)}`;
    const s = await run([pack(MsgAddArticle, { publisher: ME, title, url: 'https://a.example' })]);
    expect(Array.from(s.hero).length).toBeLessThanOrEqual(81);
    expect(s.hero).not.toContain('\u202E');
  });

  it('lists each multi-send output with its full address and contact name', async () => {
    const s = await run([sample(MsgMultiSend.typeUrl)]);
    expect(s.rows).toEqual([
      ['Total', '1,200.00 BZE'],
      ['Alex', ALEX, 'mono'],
      ['Amount', '300.00 BZE'],
      ['To', STRANGER, 'mono'],
      ['Amount', '300.00 BZE'],
      ['To', ME, 'mono'],
      ['Amount', '300.00 BZE'],
      ['To', NOBLE, 'mono'],
      ['Amount', '300.00 BZE'],
    ]);
  });

  it('is unknown when an amount it must read does not parse', async () => {
    const cases = [
      pack(factory.MsgMint, { creator: ME, coins: 'lots' }),
      pack(MsgPayPublisherRespect, { creator: ME, address: ALEX, amount: '' }),
      pack(rewards.MsgJoinStaking, { creator: ME, rewardId: '7', amount: '-5' }),
      pack(rewards.MsgCreateStakingReward, {
        creator: ME,
        prizeAmount: 'many',
        prizeDenom: VDL,
        stakingDenom: 'ubze',
        duration: '30',
        minStake: '0',
        lock: '1',
      }),
      pack(MsgDelegate, { delegatorAddress: ME, validatorAddress: VALOPER }),
      pack(MsgTransfer, { sourceChannel: 'channel-3', sender: ME, receiver: NOBLE }),
    ];
    for (const msg of cases) {
      const s = await run([msg]);
      expect(s.level, msg.typeUrl).toBe('unknown');
      expect(s.messages[0]?.icon, msg.typeUrl).not.toBe('unknown');
    }
  });

  it('pretty-prints the new types in the details sheet', () => {
    const parsed = JSON.parse(rawJson([sample(MsgDelegate.typeUrl)])) as unknown;
    expect(parsed).toEqual([
      {
        typeUrl: MsgDelegate.typeUrl,
        value: {
          delegatorAddress: ME,
          validatorAddress: VALOPER,
          amount: { denom: 'ubze', amount: '500000000' },
        },
      },
    ]);
  });
});

describe('vesting accounts, pool funding and deposits', () => {
  it('shows a vesting account as dangerous, with recipient, amount and end', async () => {
    const s = await run([sample(MsgCreateVestingAccount.typeUrl)]);
    expect(headline(s)).toBe(`Create vesting account · 5,000.00 BZE · to ${short(STRANGER)}`);
    expect(s.level).toBe('dangerous');
    expect(s.rows).toEqual([
      ['To', STRANGER, 'mono'],
      ['Amount', '5,000.00 BZE'],
      ['Vesting ends', '2027-01-15 08:00 UTC'],
      ['Unlocks', 'Gradually until the end'],
    ]);
    expect(s.dangers[0]?.title).toBe(`This sends 5,000.00 BZE to ${short(STRANGER)}`);
    expect(needsTrust(s)).toBe(true);
  });

  it('shows a vesting end in the past as a date, and unreadable times as unknown', async () => {
    const past = pack(MsgCreateVestingAccount, {
      fromAddress: ME,
      toAddress: STRANGER,
      amount: [bze('1')],
      endTime: 1n,
      delayed: true,
    });
    const s = await run([past]);
    expect(s.rows).toContainEqual(['Vesting ends', '1970-01-01 00:00 UTC']);
    expect(s.rows).toContainEqual(['Unlocks', 'All at the end']);
    const never = pack(MsgCreateVestingAccount, {
      fromAddress: ME,
      toAddress: STRANGER,
      amount: [bze('1')],
      endTime: 9_000_000_000_000_000_000n,
      delayed: false,
    });
    expect((await run([never])).rows).toContainEqual(['Vesting ends', 'Unknown']);
  });

  it('shows a permanently locked account as dangerous, with recipient and amount', async () => {
    const s = await run([sample(MsgCreatePermanentLockedAccount.typeUrl)]);
    expect(headline(s)).toBe(`Create locked account · 5,000.00 BZE · to ${short(STRANGER)}`);
    expect(s.level).toBe('dangerous');
    expect(s.rows.slice(0, 2)).toEqual([
      ['To', STRANGER, 'mono'],
      ['Amount', '5,000.00 BZE'],
    ]);
  });

  it('adds up every period of a periodic vesting account', async () => {
    const s = await run([sample(MsgCreatePeriodicVestingAccount.typeUrl)]);
    expect(headline(s)).toBe(`Create vesting account · 3.00 BZE · to ${short(STRANGER)}`);
    expect(s.level).toBe('dangerous');
    expect(s.rows).toEqual([
      ['To', STRANGER, 'mono'],
      ['Amount', '3.00 BZE'],
      ['Vesting starts', '2027-01-15 08:00 UTC'],
      ['Vesting ends', '2027-01-17 08:00 UTC'],
      ['Periods', '2'],
    ]);
  });

  it('never shows a vesting amount it cannot read as a number', async () => {
    const odd = pack(MsgCreateVestingAccount, {
      fromAddress: ME,
      toAddress: STRANGER,
      amount: [{ denom: 'ubze', amount: '1e9' }],
      endTime: 1n,
      delayed: false,
    });
    const s = await run([odd]);
    expect(s.hero).toBe('Unreadable amount');
    expect(s.level).toBe('dangerous');
  });

  it('shows the amount given to the community pool', async () => {
    const s = await run([sample(MsgFundCommunityPool.typeUrl)]);
    expect(headline(s)).toBe('Fund community pool · 2.50 BZE · to the community pool');
    expect(s.rows).toEqual([['Amount', '2.50 BZE']]);
    expect(s.level).toBe('normal');
  });

  it('shows the validator and the amount given to its delegators', async () => {
    const s = await run([sample(MsgDepositValidatorRewardsPool.typeUrl)]);
    expect(headline(s)).toBe(
      `Fund validator rewards · 1.00 BZE · for the delegators of ${short(VALOPER)}`,
    );
    expect(s.rows).toEqual([
      ['Validator', VALOPER, 'mono'],
      ['Amount', '1.00 BZE'],
    ]);
  });

  it('shows the proposal and the amount of a deposit', async () => {
    const s = await run([sample(MsgDeposit.typeUrl)]);
    expect(headline(s)).toBe('Deposit · 10.00 BZE · on proposal #42');
    expect(s.rows).toEqual([
      ['Proposal', '#42'],
      ['Amount', '10.00 BZE'],
    ]);
  });

  it('marks a deposit with an amount it cannot read as unknown, not unreadable', async () => {
    const odd = pack(MsgDeposit, {
      proposalId: 1n,
      depositor: ME,
      amount: [{ denom: '', amount: '5' }],
    });
    const s = await run([odd]);
    expect(s.level).toBe('unknown');
    expect(s.hero).toBe('Unreadable amount');
    expect(needsTrust(s)).toBe(false);
  });
});

const daoConfig = {
  minQuorum: '0.5',
  threshold: '0.333',
  votingPeriod: { seconds: 604_800n, nanos: 0 },
  allowExpedite: false,
  expeditedPeriod: { seconds: 86_400n, nanos: 0 },
  expediteQuorum: '0.6',
  expediteThreshold: '0.5',
  openSubmission: false,
  proposalCost: bze('1000000'),
  costDestination: FundsDestination.BURN,
  depositRefundPolicy: DepositRefundPolicy.ONLY_PASSED,
  keptDepositDestination: FundsDestination.TREASURY,
};
/** A send from a DAO's account (here the stranger's address) to Alex. */
const daoSend = () =>
  pack(MsgSend, { fromAddress: STRANGER, toAddress: ALEX, amount: [bze('1000000000')] });
const daoVote = (option: DaoVoteOption) => pack(dao.MsgVote, { voter: ME, proposalId: 9n, option });
const proposal = (...msgs: AnyMsg[]) =>
  pack(dao.MsgSubmitProposal, {
    proposer: ME,
    daoId: 3n,
    title: 'Fund the team',
    summary: 'Pays Alex',
    msgs: msgs.map((m) => Any.fromPartial(m)),
  });
const adminExecute = (...msgs: AnyMsg[]) =>
  pack(dao.MsgAdminExecute, { admin: ME, daoId: 3n, msgs: msgs.map((m) => Any.fromPartial(m)) });

/** A well-formed message of every v8.3 type a wallet user can sign. */
const V83_SAMPLES: Record<string, AnyMsg> = {
  [dao.MsgCreateDao.typeUrl]: pack(dao.MsgCreateDao, {
    creator: ME,
    type: DaoType.DAO_TYPE_STATIC_LIST,
    name: 'Builders',
    description: 'We build',
    config: daoConfig,
    members: [ME, ALEX],
  }),
  [dao.MsgAdminExecute.typeUrl]: adminExecute(daoSend()),
  [dao.MsgNominateAdmin.typeUrl]: pack(dao.MsgNominateAdmin, {
    authority: ME,
    daoId: 3n,
    nominee: ALEX,
  }),
  [dao.MsgAcceptAdminNomination.typeUrl]: pack(dao.MsgAcceptAdminNomination, {
    nominee: ME,
    daoId: 3n,
  }),
  [dao.MsgWithdrawAdminNomination.typeUrl]: pack(dao.MsgWithdrawAdminNomination, {
    authority: ME,
    daoId: 3n,
  }),
  [dao.MsgSubmitProposal.typeUrl]: proposal(daoSend()),
  [dao.MsgVote.typeUrl]: daoVote(DaoVoteOption.YES),
  [dao.MsgCancelProposal.typeUrl]: pack(dao.MsgCancelProposal, { proposer: ME, proposalId: 9n }),
  [dao.MsgSettleProposal.typeUrl]: pack(dao.MsgSettleProposal, { sender: ME, proposalId: 9n }),
  [dao.MsgCleanupProposal.typeUrl]: pack(dao.MsgCleanupProposal, {
    sender: ME,
    proposalId: 9n,
    limit: 50n,
  }),
  [dao.MsgUpdateDaoConfig.typeUrl]: pack(dao.MsgUpdateDaoConfig, {
    authority: STRANGER,
    daoId: 3n,
    config: daoConfig,
  }),
  [dao.MsgUpdateMetadata.typeUrl]: pack(dao.MsgUpdateMetadata, {
    authority: STRANGER,
    daoId: 3n,
    name: 'Builders 2',
    description: 'We build more',
  }),
  [dao.MsgUpdateElectorate.typeUrl]: pack(dao.MsgUpdateElectorate, {
    authority: STRANGER,
    daoId: 3n,
    electorate: { srIds: ['7'], drDenom: VDL },
  }),
  [dao.MsgUpdateMembers.typeUrl]: pack(dao.MsgUpdateMembers, {
    authority: STRANGER,
    daoId: 3n,
    add: [ALEX],
    remove: [],
  }),
  [factory.MsgSetDenomConfig.typeUrl]: pack(factory.MsgSetDenomConfig, {
    creator: ME,
    denom: VDL,
    communityPool: ALEX,
    transferFee: '0.01',
    gasSurcharge: '0.5',
  }),
  [factory.MsgDisableMinting.typeUrl]: pack(factory.MsgDisableMinting, { creator: ME, denom: VDL }),
  [guardian.MsgTightenRateLimit.typeUrl]: pack(guardian.MsgTightenRateLimit, {
    signer: ME,
    denom: 'ubze',
    channelId: 'channel-0',
    maxPercentSend: '5',
    maxPercentRecv: '10',
  }),
  [guardian.MsgBlockDenom.typeUrl]: pack(guardian.MsgBlockDenom, { signer: ME, denom: USDC }),
  [guardian.MsgDisableMessages.typeUrl]: pack(guardian.MsgDisableMessages, {
    signer: ME,
    msgTypeUrls: [MsgSend.typeUrl],
  }),
  [guardian.MsgHaltTradingDenoms.typeUrl]: pack(guardian.MsgHaltTradingDenoms, {
    signer: ME,
    denoms: [VDL],
  }),
  [guardian.MsgHaltChain.typeUrl]: pack(guardian.MsgHaltChain, {
    signer: ME,
    reason: 'maintenance',
  }),
  [guardian.MsgPauseAutomation.typeUrl]: pack(guardian.MsgPauseAutomation, { signer: ME }),
  [guardian.MsgCloseChannel.typeUrl]: pack(guardian.MsgCloseChannel, {
    signer: ME,
    channelId: 'channel-0',
  }),
};
const v83 = (typeUrl: string): AnyMsg => {
  const msg = V83_SAMPLES[typeUrl];
  if (!msg) throw new Error(`no sample for ${typeUrl}`);
  return msg;
};

describe('DAO votes', () => {
  it('names every option of the DAO module, which orders them unlike x/gov', async () => {
    const heroes = await Promise.all(
      [DaoVoteOption.YES, DaoVoteOption.NO, DaoVoteOption.ABSTAIN].map(
        async (option) => (await run([daoVote(option)])).hero,
      ),
    );
    expect(heroes).toEqual(['Yes', 'No', 'Abstain']);
    const s = await run([daoVote(DaoVoteOption.NO)]);
    expect(headline(s)).toBe('DAO vote · No · on DAO proposal #9');
    expect(s.level).toBe('normal');
    expect(s.messages[0]?.icon).toBe('vote');
    expect(s.rows).toEqual([
      ['Proposal', '#9'],
      ['Vote', 'No'],
    ]);
  });

  it('is unknown for an unspecified vote', async () => {
    const s = await run([daoVote(DaoVoteOption.VOTE_OPTION_UNSPECIFIED)]);
    expect(s.hero).toBe('Unknown vote');
    expect(s.level).toBe('unknown');
  });
});

describe('DAO proposals', () => {
  it('shows the title, the DAO and every message it would run as the DAO', async () => {
    const s = await run([proposal(daoSend())]);
    expect(headline(s)).toBe('DAO proposal · Fund the team · to DAO #3 · 1 message');
    expect(s.level).toBe('normal');
    expect(s.messages[0]?.unreadable).toBe(false);
    expect(s.rows).toEqual([
      ['DAO', 'DAO #3'],
      ['Title', 'Fund the team'],
      ['Summary', 'Pays Alex'],
      ['Voting', 'Normal'],
      ['You pay', "The DAO's proposal cost and deposit, if it has them"],
      ['Message 1', 'Send · 1,000.00 BZE · to Alex'],
      ['Runs as', 'DAO #3, if it passes'],
      ['To', ALEX, 'mono'],
      ['Amount', '1,000.00 BZE'],
    ]);
  });

  it('never says a message inside runs from your own account', async () => {
    const mine = pack(MsgSend, { fromAddress: ME, toAddress: ALEX, amount: [bze('1')] });
    const s = await run([proposal(mine)]);
    expect(s.rows).toContainEqual(['Runs as', 'DAO #3, if it passes']);
    expect(s.rows.map((r) => r[1])).not.toContain('Your own account');
  });

  it('is dangerous when the wallet cannot read a message inside', async () => {
    const s = await run([proposal(daoSend(), wasm)]);
    expect(s.level).toBe('dangerous');
    expect(s.dangers.map((d) => d.title)).toEqual(['The wallet cannot read 1 message inside']);
    expect(needsTrust(s)).toBe(true);
  });

  it('is as risky as the riskiest message it would run', async () => {
    const members = await run([proposal(v83(dao.MsgUpdateMembers.typeUrl))]);
    expect(members.level).toBe('dangerous');
    expect(members.dangers.map((d) => d.title)).toEqual(['A message inside needs extra care']);
    expect(needsTrust(members)).toBe(true);
    const nested = await run([proposal(exec(wasm))]);
    expect(nested.level).toBe('dangerous');
    const odd = await run([proposal(daoVote(DaoVoteOption.VOTE_OPTION_UNSPECIFIED))]);
    expect(odd.level).toBe('unknown');
  });

  it('stops reading proposals nested too deeply', async () => {
    const s = await run([proposal(proposal(proposal(daoSend())))]);
    expect(s.level).toBe('dangerous');
  });

  it('lists how many messages it does not show', async () => {
    const s = await run([proposal(...Array.from({ length: 12 }, () => daoSend()))]);
    expect(s.rows.filter((r) => r[0].startsWith('Message '))).toHaveLength(10);
    expect(s.rows[s.rows.length - 1]).toEqual(['…', '2 more messages']);
  });

  it('shows cancel, settle and clean-up by proposal', async () => {
    expect(headline(await run([v83(dao.MsgCancelProposal.typeUrl)]))).toBe(
      'Cancel DAO proposal · Proposal #9 · withdraws your proposal from the vote',
    );
    expect(headline(await run([v83(dao.MsgSettleProposal.typeUrl)]))).toBe(
      'Settle DAO proposal · Proposal #9 · counts the votes and runs it if it passed',
    );
    expect(headline(await run([v83(dao.MsgCleanupProposal.typeUrl)]))).toBe(
      'Clean up DAO proposal · Proposal #9 · deletes a finished proposal',
    );
  });
});

describe('DAO admin', () => {
  it('runs messages as the DAO at once: dangerous, with every message shown', async () => {
    const s = await run([adminExecute(daoSend())]);
    expect(s.level).toBe('dangerous');
    expect(headline(s)).toBe('Run as DAO admin · 1 message · as DAO #3');
    expect(s.rows).toEqual([
      ['DAO', 'DAO #3'],
      ['Message 1', 'Send · 1,000.00 BZE · to Alex'],
      ['Runs as', 'DAO #3'],
      ['To', ALEX, 'mono'],
      ['Amount', '1,000.00 BZE'],
    ]);
    expect(s.dangers[0]?.title).toBe('This acts as DAO #3 at once');
  });

  it('warns about a message inside it cannot read', async () => {
    const s = await run([adminExecute(wasm)]);
    expect(s.level).toBe('dangerous');
    expect(s.dangers.map((d) => d.title)).toContain('The wallet cannot read 1 message inside');
  });

  it('makes nominating an admin or handing the DAO to its voters dangerous', async () => {
    const nominate = await run([v83(dao.MsgNominateAdmin.typeUrl)]);
    expect(headline(nominate)).toBe('Nominate DAO admin · DAO #3 · to Alex');
    expect(nominate.level).toBe('dangerous');
    expect(nominate.dangers[0]?.title).toBe('This offers Alex control of DAO #3');
    const giveUp = await run([
      pack(dao.MsgNominateAdmin, { authority: ME, daoId: 3n, nominee: '' }),
    ]);
    expect(headline(giveUp)).toBe('Give up DAO admin · DAO #3 · its voters run it from now on');
    expect(giveUp.level).toBe('dangerous');
  });

  it('shows accepting and withdrawing a nomination', async () => {
    const accept = await run([v83(dao.MsgAcceptAdminNomination.typeUrl)]);
    expect(headline(accept)).toBe('Accept DAO admin · DAO #3 · you become its admin');
    expect(accept.level).toBe('normal');
    const withdraw = await run([v83(dao.MsgWithdrawAdminNomination.typeUrl)]);
    expect(headline(withdraw)).toBe(
      'Withdraw DAO admin offer · DAO #3 · cancels the pending handover',
    );
  });
});

describe('DAO creation and changes', () => {
  it('shows the members and voting rules of a new DAO', async () => {
    const s = await run([v83(dao.MsgCreateDao.typeUrl)]);
    expect(headline(s)).toBe('Create DAO · Builders · voted by 2 members');
    expect(s.level).toBe('normal');
    expect(s.rows).toEqual([
      ['Name', 'Builders'],
      ['Description', 'We build'],
      ['Admin', 'None: its voters run it'],
      ['Members', '2 members'],
      ['Member', ME, 'mono'],
      ['Member', ALEX, 'mono'],
      ['Quorum', '50%'],
      ['Passes above', '33.3% yes'],
      ['Voting period', '7 days'],
      ['Expedited voting', 'Off'],
      ['Who can propose', 'Voters only'],
      ['Proposal cost', '1.00 BZE, burned'],
      ['Proposal deposit', 'None'],
      ['Creation fee', "The chain's DAO creation fee"],
    ]);
  });

  it('shows a stake DAO, its expedited voting and its deposit', async () => {
    const s = await run([
      pack(dao.MsgCreateDao, {
        creator: ME,
        admin: ALEX,
        type: DaoType.DAO_TYPE_STAKE,
        name: 'Stakers',
        config: {
          ...daoConfig,
          allowExpedite: true,
          openSubmission: true,
          proposalDeposit: bze('5000000'),
        },
        electorate: { srIds: ['7'], drDenom: '' },
      }),
    ]);
    expect(headline(s)).toBe('Create DAO · Stakers · voted by stakers');
    expect(s.rows).toContainEqual(['Admin', ALEX, 'mono']);
    expect(s.rows).toContainEqual(['Voters', 'Stakers of staking reward 7']);
    expect(s.rows).toContainEqual(['Expedited voting', '1 day, quorum 60%, passes above 50% yes']);
    expect(s.rows).toContainEqual(['Who can propose', 'Anyone']);
    expect(s.rows).toContainEqual([
      'Proposal deposit',
      "5.00 BZE, given back only when the proposal passes; when kept, kept in the DAO's account",
    ]);
  });

  it('makes changes to the rules, voters and members dangerous', async () => {
    for (const typeUrl of [
      dao.MsgUpdateDaoConfig.typeUrl,
      dao.MsgUpdateElectorate.typeUrl,
      dao.MsgUpdateMembers.typeUrl,
    ]) {
      const s = await run([v83(typeUrl)]);
      expect(s.level, typeUrl).toBe('dangerous');
      expect(s.dangers[0]?.title, typeUrl).toBe('This changes who decides in DAO #3');
    }
    const members = await run([v83(dao.MsgUpdateMembers.typeUrl)]);
    expect(headline(members)).toBe(
      'Change DAO members · DAO #3 · adds 1 member, removes 0 members',
    );
    expect(members.rows).toContainEqual(['Add', ALEX, 'mono']);
    const voters = await run([v83(dao.MsgUpdateElectorate.typeUrl)]);
    expect(voters.rows).toContainEqual([
      'Voters',
      `Stakers of staking reward 7, holder reward of ${VDL}`,
    ]);
    const config = await run([v83(dao.MsgUpdateDaoConfig.typeUrl)]);
    expect(config.rows).toContainEqual(['Passes above', '33.3% yes']);
  });

  it('shows a new name as an ordinary change', async () => {
    const s = await run([v83(dao.MsgUpdateMetadata.typeUrl)]);
    expect(headline(s)).toBe('Rename DAO · DAO #3 · to Builders 2');
    expect(s.level).toBe('normal');
  });
});

describe('token config', () => {
  it('names the token and its new fees', async () => {
    const s = await run([v83(factory.MsgSetDenomConfig.typeUrl)]);
    expect(headline(s)).toBe('Set token fees · VDL · 1% transfer fee, 50% gas surcharge');
    expect(s.level).toBe('normal');
    expect(s.rows).toEqual([
      ['Token', 'VDL'],
      ['Transfer fee', '1%'],
      ['Gas surcharge', '50%'],
      ['Fees go to', ALEX, 'mono'],
    ]);
    const none = await run([
      pack(factory.MsgSetDenomConfig, {
        creator: ME,
        denom: VDL,
        communityPool: '',
        transferFee: '0',
        gasSurcharge: '0',
      }),
    ]);
    expect(none.rows).toEqual([
      ['Token', 'VDL'],
      ['Transfer fee', '0%'],
      ['Gas surcharge', '0%'],
      ['Fees go to', 'No one'],
    ]);
  });

  it('makes turning minting off for good dangerous', async () => {
    const s = await run([v83(factory.MsgDisableMinting.typeUrl)]);
    expect(headline(s)).toBe('Stop minting · VDL · for good');
    expect(s.level).toBe('dangerous');
    expect(s.dangers[0]?.title).toBe('No one can mint VDL again');
  });
});

describe('guardian actions', () => {
  it.each([
    [guardian.MsgTightenRateLimit.typeUrl, 'Tighten an IBC rate limit'],
    [guardian.MsgBlockDenom.typeUrl, 'Block a token over IBC'],
    [guardian.MsgDisableMessages.typeUrl, 'Turn off message types'],
    [guardian.MsgHaltTradingDenoms.typeUrl, 'Halt trading of tokens'],
    [guardian.MsgHaltChain.typeUrl, 'Halt the chain'],
    [guardian.MsgPauseAutomation.typeUrl, 'Pause automatic chain jobs'],
    [guardian.MsgCloseChannel.typeUrl, 'Close an IBC channel'],
  ])('%s names the action and is dangerous', async (typeUrl, action) => {
    const s = await run([v83(typeUrl)]);
    expect(s.title).toBe('Guardian action');
    expect(s.hero).toBe(action);
    expect(s.level).toBe('dangerous');
    expect(s.messages[0]?.unreadable).toBe(false);
    expect(s.dangers[0]?.title).toBe('Only a chain guardian can send this');
  });

  it('shows the reason of a chain halt', async () => {
    const s = await run([v83(guardian.MsgHaltChain.typeUrl)]);
    expect(s.rows).toEqual([
      ['Action', 'Halt the chain'],
      ['Reason', 'maintenance'],
    ]);
  });
});

/**
 * Message types every supported chain version registers, one fixture per version. Regenerate
 * them from the chain source at every chain upgrade (see `test/fixtures/registry/README.md`).
 */
const REGISTRY: [string, string[]][] = [
  ['v8.2.0', registryV820],
  ['v8.3', registryV83],
];

/** A well-formed message of every type the wallet summarises. */
const WELL_FORMED: Record<string, AnyMsg> = {
  ...SAMPLES,
  ...V83_SAMPLES,
  [MsgSend.typeUrl]: send(),
  [MsgMultiSwap.typeUrl]: swap(),
  [MsgCreateOrder.typeUrl]: order('buy'),
  [MsgCancelOrder.typeUrl]: pack(MsgCancelOrder, {
    creator: ME,
    marketId: BZE_USDC.id,
    orderId: '1',
    orderType: 'buy',
  }),
  [MsgFillOrders.typeUrl]: pack(MsgFillOrders, {
    creator: ME,
    marketId: BZE_USDC.id,
    orderType: 'buy',
    orders: [{ price: '0.3', amount: '100000000' }],
  }),
  [MsgAddLiquidity.typeUrl]: pack(MsgAddLiquidity, {
    creator: ME,
    poolId: 'pool-bze-usdc',
    baseAmount: '100000000',
    quoteAmount: '33500000',
    minLpTokens: '5000000000000',
  }),
  [MsgRemoveLiquidity.typeUrl]: pack(MsgRemoveLiquidity, {
    creator: ME,
    poolId: 'pool-bze-usdc',
    lpTokens: '12500000000000',
    minBase: '10000000',
    minQuote: '3350000',
  }),
  [MsgFundBurner.typeUrl]: pack(MsgFundBurner, { creator: ME, amount: '1500000ubze' }),
  [MsgJoinRaffle.typeUrl]: pack(MsgJoinRaffle, { creator: ME, denom: VDL, tickets: 1n }),
  [MsgVote.typeUrl]: vote(VoteOption.VOTE_OPTION_YES),
  [MsgGrant.typeUrl]: grant(),
  [MsgGrantAllowance.typeUrl]: pack(MsgGrantAllowance, {
    granter: ME,
    grantee: ALEX,
    allowance: wrap(BasicAllowance, { spendLimit: [bze('2000000')] }),
  }),
  [MsgExec.typeUrl]: exec(send()),
};

/**
 * Types the wallet knowingly cannot read: approving one needs the trust tick. Moving a type out
 * of here means giving it a summary or making it governance-only.
 */
const TICK_ONLY = new Set([
  '/cosmos.auth.v1beta1.MsgUpdateParams',
  '/cosmos.authz.v1beta1.MsgRevoke',
  '/cosmos.bank.v1beta1.MsgSetSendEnabled',
  '/cosmos.bank.v1beta1.MsgUpdateParams',
  '/cosmos.circuit.v1.MsgAuthorizeCircuitBreaker',
  '/cosmos.circuit.v1.MsgResetCircuitBreaker',
  '/cosmos.circuit.v1.MsgTripCircuitBreaker',
  '/cosmos.consensus.v1.MsgUpdateParams',
  '/cosmos.distribution.v1beta1.MsgCommunityPoolSpend',
  '/cosmos.distribution.v1beta1.MsgUpdateParams',
  '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
  '/cosmos.evidence.v1beta1.MsgSubmitEvidence',
  '/cosmos.feegrant.v1beta1.MsgPruneAllowances',
  '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
  '/cosmos.gov.v1.MsgCancelProposal',
  '/cosmos.gov.v1.MsgExecLegacyContent',
  '/cosmos.gov.v1.MsgSubmitProposal',
  '/cosmos.gov.v1.MsgUpdateParams',
  '/cosmos.gov.v1.MsgVoteWeighted',
  '/cosmos.gov.v1beta1.MsgDeposit',
  '/cosmos.gov.v1beta1.MsgSubmitProposal',
  '/cosmos.gov.v1beta1.MsgVote',
  '/cosmos.gov.v1beta1.MsgVoteWeighted',
  '/cosmos.group.v1.MsgCreateGroup',
  '/cosmos.group.v1.MsgCreateGroupPolicy',
  '/cosmos.group.v1.MsgCreateGroupWithPolicy',
  '/cosmos.group.v1.MsgExec',
  '/cosmos.group.v1.MsgLeaveGroup',
  '/cosmos.group.v1.MsgSubmitProposal',
  '/cosmos.group.v1.MsgUpdateGroupAdmin',
  '/cosmos.group.v1.MsgUpdateGroupMembers',
  '/cosmos.group.v1.MsgUpdateGroupMetadata',
  '/cosmos.group.v1.MsgUpdateGroupPolicyAdmin',
  '/cosmos.group.v1.MsgUpdateGroupPolicyDecisionPolicy',
  '/cosmos.group.v1.MsgUpdateGroupPolicyMetadata',
  '/cosmos.group.v1.MsgVote',
  '/cosmos.group.v1.MsgWithdrawProposal',
  '/cosmos.mint.v1beta1.MsgUpdateParams',
  '/cosmos.nft.v1beta1.MsgSend',
  '/cosmos.slashing.v1beta1.MsgUnjail',
  '/cosmos.slashing.v1beta1.MsgUpdateParams',
  '/cosmos.staking.v1beta1.MsgCreateValidator',
  '/cosmos.staking.v1beta1.MsgEditValidator',
  '/cosmos.staking.v1beta1.MsgUpdateParams',
  '/cosmos.upgrade.v1beta1.MsgCancelUpgrade',
  '/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade',
  '/ibc.applications.fee.v1.MsgPayPacketFee',
  '/ibc.applications.fee.v1.MsgPayPacketFeeAsync',
  '/ibc.applications.fee.v1.MsgRegisterCounterpartyPayee',
  '/ibc.applications.fee.v1.MsgRegisterPayee',
  '/ibc.applications.interchain_accounts.controller.v1.MsgRegisterInterchainAccount',
  '/ibc.applications.interchain_accounts.controller.v1.MsgSendTx',
  '/ibc.applications.interchain_accounts.controller.v1.MsgUpdateParams',
  '/ibc.applications.interchain_accounts.host.v1.MsgModuleQuerySafe',
  '/ibc.applications.interchain_accounts.host.v1.MsgUpdateParams',
  '/ibc.applications.transfer.v1.MsgUpdateParams',
  '/ibc.core.channel.v1.MsgAcknowledgement',
  '/ibc.core.channel.v1.MsgChannelCloseConfirm',
  '/ibc.core.channel.v1.MsgChannelCloseInit',
  '/ibc.core.channel.v1.MsgChannelOpenAck',
  '/ibc.core.channel.v1.MsgChannelOpenConfirm',
  '/ibc.core.channel.v1.MsgChannelOpenInit',
  '/ibc.core.channel.v1.MsgChannelOpenTry',
  '/ibc.core.channel.v1.MsgChannelUpgradeAck',
  '/ibc.core.channel.v1.MsgChannelUpgradeCancel',
  '/ibc.core.channel.v1.MsgChannelUpgradeConfirm',
  '/ibc.core.channel.v1.MsgChannelUpgradeInit',
  '/ibc.core.channel.v1.MsgChannelUpgradeOpen',
  '/ibc.core.channel.v1.MsgChannelUpgradeTimeout',
  '/ibc.core.channel.v1.MsgChannelUpgradeTry',
  '/ibc.core.channel.v1.MsgPruneAcknowledgements',
  '/ibc.core.channel.v1.MsgRecvPacket',
  '/ibc.core.channel.v1.MsgTimeout',
  '/ibc.core.channel.v1.MsgTimeoutOnClose',
  '/ibc.core.channel.v1.MsgUpdateParams',
  '/ibc.core.channel.v2.MsgAcknowledgement',
  '/ibc.core.channel.v2.MsgRecvPacket',
  '/ibc.core.channel.v2.MsgSendPacket',
  '/ibc.core.channel.v2.MsgTimeout',
  '/ibc.core.client.v1.MsgCreateClient',
  '/ibc.core.client.v1.MsgDeleteClientCreator',
  '/ibc.core.client.v1.MsgIBCSoftwareUpgrade',
  '/ibc.core.client.v1.MsgRecoverClient',
  '/ibc.core.client.v1.MsgSubmitMisbehaviour',
  '/ibc.core.client.v1.MsgUpdateClient',
  '/ibc.core.client.v1.MsgUpdateParams',
  '/ibc.core.client.v1.MsgUpgradeClient',
  '/ibc.core.client.v2.MsgRegisterCounterparty',
  '/ibc.core.client.v2.MsgUpdateClientConfig',
  '/ibc.core.connection.v1.MsgConnectionOpenAck',
  '/ibc.core.connection.v1.MsgConnectionOpenConfirm',
  '/ibc.core.connection.v1.MsgConnectionOpenInit',
  '/ibc.core.connection.v1.MsgConnectionOpenTry',
  '/ibc.core.connection.v1.MsgUpdateParams',
]);

describe('every message type the chain registers', () => {
  it.each(REGISTRY)('%s: each type is summarised, governed or ticked', async (version, types) => {
    const uncovered: string[] = [];
    for (const typeUrl of types) {
      if (GOVERNED.has(typeUrl)) {
        const s = await run([{ typeUrl, value: new Uint8Array() }]);
        expect(s.messages[0]?.icon, typeUrl).toBe('settings');
        continue;
      }
      const msg = WELL_FORMED[typeUrl];
      if (msg) {
        const s = await run([msg]);
        expect(s.messages[0]?.unreadable, typeUrl).toBe(false);
        expect(s.messages[0]?.icon, typeUrl).not.toBe('unknown');
        continue;
      }
      if (!TICK_ONLY.has(typeUrl)) {
        uncovered.push(`${version}: ${typeUrl}`);
        continue;
      }
      const s = await run([{ typeUrl, value: new Uint8Array([1, 2, 3]) }]);
      expect(s.messages[0]?.unreadable, typeUrl).toBe(true);
      expect(needsTrust(s), typeUrl).toBe(true);
    }
    expect(uncovered).toEqual([]);
  });

  it('lists only types some supported version registers', () => {
    const all = new Set(REGISTRY.flatMap(([, types]) => types));
    expect([...TICK_ONLY].filter((t) => !all.has(t))).toEqual([]);
    expect(Object.keys(WELL_FORMED).filter((t) => !all.has(t))).toEqual([]);
  });

  it('fails for a registered type with no summary, policy or tick entry', async () => {
    const typeUrl = '/bze.newmodule.MsgDoSomething';
    expect(GOVERNED.has(typeUrl) || typeUrl in WELL_FORMED || TICK_ONLY.has(typeUrl)).toBe(false);
    // The tick still catches it at signing time.
    expect(needsTrust(await run([{ typeUrl, value: new Uint8Array() }]))).toBe(true);
  });
});

describe('multi-send review', () => {
  const out = (address: string, denom: string, amount: string) => ({
    address,
    coins: [{ denom, amount }],
  });
  const multiSend = (outputs: { address: string; coins: { denom: string; amount: string }[] }[]) =>
    pack(MsgMultiSend, { inputs: [{ address: ME, coins: [] }], outputs });
  const monoValues = (s: TxSummary) => s.rows.filter((r) => r[2] === 'mono').map((r) => r[1]);
  const dust = out(STRANGER, 'ubze', '1');

  it('shows an output past the first ten in full, and a total per token', async () => {
    const outputs = [
      ...Array.from({ length: 10 }, () => out(ME, 'ubze', '1')),
      out(STRANGER, USDC, '5000000000'),
    ];
    const s = await run([multiSend(outputs)]);
    expect(monoValues(s)).toContain(STRANGER);
    expect(s.rows).toContainEqual(['Amount', '5,000.00 USDC']);
    expect(s.rows).toContainEqual(['Total', '0.00001 BZE']);
    expect(s.rows).toContainEqual(['Total', '5,000.00 USDC']);
    expect(s.level).toBe('normal');
    expect(needsTrust(s)).toBe(false);
  });

  it('is unknown with no outputs', async () => {
    const s = await run([multiSend([])]);
    expect(s.level).toBe('unknown');
    expect(s.hero).toBe('No tokens');
  });

  it('shows the full address of a single output, like a send', async () => {
    const s = await run([multiSend([out(STRANGER, 'ubze', '1000000')])]);
    expect(s.rows).toEqual([
      ['To', STRANGER, 'mono'],
      ['Amount', '1.00 BZE'],
    ]);
    expect(s.hero).toBe('1.00 BZE');
  });

  it('lists every recipient of a long airdrop without asking for the tick', async () => {
    const s = await run([multiSend(Array.from({ length: 1000 }, () => dust))]);
    expect(monoValues(s)).toHaveLength(1000);
    expect(s.level).toBe('normal');
    expect(needsTrust(s)).toBe(false);
    expect(JSON.stringify(s.rows)).not.toContain('Showing');
  });

  it('says when the list is cut short, totals every output and asks for the tick', async () => {
    const s = await run([multiSend(Array.from({ length: 1001 }, () => dust))]);
    expect(monoValues(s)).toHaveLength(1000);
    expect(s.rows).toContainEqual(['…', 'Showing 1,000 of 1,001 recipients']);
    expect(s.rows).toContainEqual(['Total', '0.001001 BZE']);
    expect(s.level).toBe('dangerous');
    expect(needsTrust(s)).toBe(true);
    expect(s.dangers.length).toBeGreaterThan(0);
  });
});

describe('IBC transfer destination', () => {
  const OSMO = 'osmo1r5v5srda7xfth3hn2s26txvrcrntldjuh9m7ad';
  const FINAL = 'cosmos1vtad8680vhdfqvxx0f2yaxa6agdylelm7vcg6e';
  const transfer = (memo: string, receiver = NOBLE) =>
    pack(MsgTransfer, {
      sourcePort: 'transfer',
      sourceChannel: 'channel-3',
      token: { denom: USDC, amount: '25000000' },
      sender: ME,
      receiver,
      memo,
    });
  const forward = (receiver: string, extra: Record<string, unknown> = {}) => ({
    forward: { ...extra, receiver, port: 'transfer', channel: 'channel-0' },
  });
  /** `count` forwards, each nested in the one before, ending at `FINAL`. */
  const hops = (count: number): Record<string, unknown> => {
    let memo = forward(FINAL);
    for (let i = 1; i < count; i += 1) memo = forward(OSMO, { next: memo });
    return memo;
  };

  it('names the forward receiver as the final recipient', async () => {
    const s = await run([transfer(JSON.stringify(forward(OSMO)))]);
    expect(s.sub).toContain(OSMO);
    expect(s.rows).toContainEqual(['Final recipient', OSMO, 'mono']);
    expect(s.level).toBe('dangerous');
    expect(needsTrust(s)).toBe(true);
    expect(JSON.stringify(s.dangers)).toContain(OSMO);
  });

  it('names the forward receiver of a long memo in full', async () => {
    const memo = JSON.stringify(forward(OSMO, { note: 'p'.repeat(300) }));
    expect(memo.indexOf(OSMO)).toBeGreaterThan(200);
    const s = await run([transfer(memo)]);
    expect(s.sub).toContain(OSMO);
    expect(s.rows).toContainEqual(['Final recipient', OSMO, 'mono']);
  });

  it('follows nested forwards to the last receiver, as an object or as a JSON string', async () => {
    const inner = forward(FINAL);
    for (const next of [inner, JSON.stringify(inner)]) {
      const s = await run([transfer(JSON.stringify(forward(OSMO, { next })))]);
      expect(s.sub, typeof next).toContain(FINAL);
      expect(s.rows, typeof next).toContainEqual(['Final recipient', FINAL, 'mono']);
      expect(s.level).toBe('dangerous');
    }
  });

  it('says the final recipient is unknown for a contract call', async () => {
    const s = await run([transfer(JSON.stringify({ wasm: { contract: OSMO, msg: {} } }))]);
    expect(s.sub).toContain('unknown');
    expect(s.rows).toContainEqual(['Final recipient', 'Unknown (contract call)']);
    expect(s.level).toBe('dangerous');
    expect(needsTrust(s)).toBe(true);
  });

  it('reads eight forwards, a null next and padded keys', async () => {
    const memos = [
      JSON.stringify(hops(8)),
      JSON.stringify(forward(FINAL, { next: null })),
      `{ "forward" : { "receiver" : "${FINAL}" , "channel" : "channel-0" } }`,
    ];
    for (const memo of memos) {
      const s = await run([transfer(memo)]);
      expect(s.rows, memo).toContainEqual(['Final recipient', FINAL, 'mono']);
      expect(s.sub, memo).toContain(FINAL);
      expect(s.level, memo).toBe('dangerous');
    }
  });

  it('says the final recipient is unknown for a contract call after a forward', async () => {
    const memo = JSON.stringify(forward(OSMO, { next: { wasm: { contract: OSMO, msg: {} } } }));
    const s = await run([transfer(memo)]);
    expect(s.rows).toContainEqual(['Final recipient', 'Unknown (contract call)']);
    expect(s.sub).not.toContain(OSMO);
    expect(s.level).toBe('dangerous');
  });

  it.each([
    ['another spelling of the key', JSON.stringify({ Forward: { receiver: OSMO } })],
    ['another spelling of the receiver', JSON.stringify({ forward: { Receiver: OSMO } })],
    ['a receiver that is not text', JSON.stringify({ forward: { receiver: 7 } })],
    ['no receiver', JSON.stringify({ forward: { channel: 'channel-0' } })],
    ['a forward that is not an object', JSON.stringify({ forward: 'osmo1' })],
    ['a next that does not parse', JSON.stringify(forward(OSMO, { next: '{nope' }))],
    ['broken JSON', `{"forward":{"receiver":"${OSMO}"`],
    [
      'a key that appears twice',
      `{"forward":{"receiver":"${OSMO}","next":{"forward":{"receiver":"${FINAL}"}}},` +
        `"forward":{"receiver":"${OSMO}"}}`,
    ],
    [
      'a key that appears twice in another spelling',
      `{"forward":{"receiver":"${OSMO}","Receiver":"${FINAL}"}}`,
    ],
    ['a receiver that is not an address', JSON.stringify({ forward: { receiver: 'pay to bob' } })],
    ['a contract call in capitals', JSON.stringify({ WASM: { contract: OSMO, msg: {} } })],
    ['a contract call in mixed case', JSON.stringify({ Wasm: { contract: OSMO, msg: {} } })],
    ['a key with a long s', JSON.stringify({ 'wa\u017fm': { contract: OSMO, msg: {} } })],
    [
      'a long-s contract key next to a forward',
      `{"forward":{"receiver":"${OSMO}"},"wa\u017fm":{}}`,
    ],
    ['a forward and a contract call together', JSON.stringify({ ...forward(OSMO), wasm: {} })],
    ['an array of instructions', JSON.stringify([forward(OSMO)])],
    ['more than eight forwards', JSON.stringify(hops(9))],
  ])('says the final recipient is unknown for %s', async (_, memo) => {
    const s = await run([transfer(memo)]);
    expect(s.level).toBe('dangerous');
    expect(s.rows.find((r) => r[0] === 'Final recipient')?.[1]).toMatch(/^Unknown/);
    expect(s.sub).toContain('unknown');
  });

  it('never shows only a contact name when the memo forwards the tokens', async () => {
    const s = await run([transfer(JSON.stringify(forward(OSMO)))], {
      addressBook: (a) => (a === NOBLE || a === OSMO ? 'Alex' : null),
    });
    expect(s.sub).toContain(OSMO);
  });

  it('stays normal with a plain memo or none', async () => {
    for (const memo of ['', 'thanks for lunch', '{"note":"hi"}', '[1,2]']) {
      const s = await run([transfer(memo)]);
      expect(s.level, memo).toBe('normal');
      expect(s.sub, memo).toBe(`to ${short(NOBLE)} on another chain · channel-3`);
    }
  });
});

describe('protocol fees', () => {
  const down = () => Promise.reject(new Error('node down'));
  const creations = () => [
    sample(factory.MsgCreateDenom.typeUrl),
    sample(MsgCreateMarket.typeUrl),
    sample(MsgCreateLiquidityPool.typeUrl),
  ];
  const fill = pack(MsgFillOrders, {
    creator: ME,
    marketId: BZE_USDC.id,
    orderType: 'sell',
    orders: [{ price: '0.3', amount: '100000000' }],
  });

  it('shows the creation fee of a new token, market or pool', async () => {
    for (const msg of creations()) {
      const s = await run([msg]);
      expect(s.rows, msg.typeUrl).toContainEqual(['Creation fee', '25,000.00 BZE']);
    }
  });

  it('shows the trading fee of an order, a fill and a swap', async () => {
    const order = await run([
      pack(MsgCreateOrder, {
        creator: ME,
        marketId: BZE_USDC.id,
        orderType: 'buy',
        amount: '500000000',
        price: '0.335',
      }),
    ]);
    expect(order.rows).toContainEqual([
      'Trading fee',
      '0.001 BZE if it waits on the book, 0.10 BZE if it fills at once',
    ]);
    expect((await run([fill])).rows).toContainEqual(['Trading fee', '0.10 BZE']);
    expect((await run([swap()])).rows).toContainEqual(['Trading fee', '0.10 BZE']);
  });

  it('falls back to a generic fee text when the fees cannot be read', async () => {
    const failing = [
      { tradebinParams: down, tokenFactoryParams: down },
      stubChain(),
      {
        tradebinParams: () =>
          Promise.resolve({ nativeDenom: 'ubze', minNativeLiquidityForModuleSwap: 1n }),
        tokenFactoryParams: () => Promise.resolve({}),
      },
    ];
    for (const fees of failing) {
      for (const msg of creations()) {
        const s = await run([msg], { fees });
        expect(s.rows, msg.typeUrl).toContainEqual(['Creation fee', "The chain's creation fee"]);
      }
      expect((await run([fill], { fees })).rows).toContainEqual([
        'Trading fee',
        "The chain's trading fee",
      ]);
      expect((await run([swap()], { fees })).rows).toContainEqual([
        'Trading fee',
        "The chain's trading fee",
      ]);
    }
  });

  it('reads the fee settings once per summary', async () => {
    const tradebinParams = vi.fn().mockResolvedValue({
      nativeDenom: 'ubze',
      minNativeLiquidityForModuleSwap: 1n,
      marketTakerFee: { denom: 'ubze', amount: 100_000n },
    });
    const tokenFactoryParams = vi.fn().mockResolvedValue({});
    const denom = sample(factory.MsgCreateDenom.typeUrl);
    const fees = { tradebinParams, tokenFactoryParams };
    await run([swap(), swap(), fill, denom, denom], { fees });
    expect(tradebinParams).toHaveBeenCalledTimes(1);
    expect(tokenFactoryParams).toHaveBeenCalledTimes(1);
  });
});

describe('rewards address change', () => {
  const change = (withdrawAddress: string, delegatorAddress = ME) =>
    pack(MsgSetWithdrawAddress, { delegatorAddress, withdrawAddress });

  it.each([
    ['a stranger', STRANGER],
    ['a contact', ALEX],
    [
      'an address of another chain with your bytes',
      bech32.encode('cosmos', bech32.decode(ME as `${string}1${string}`).words),
    ],
    ['an invalid address', 'bze1nope'],
  ])('warns before sending future rewards to %s', async (_, address) => {
    const s = await run([change(address)]);
    expect(s.level).toBe('dangerous');
    expect(needsTrust(s)).toBe(true);
    expect(s.dangers).toHaveLength(1);
    expect(s.dangers[0]?.text).toContain('staking rewards');
    expect(s.rows).toContainEqual(['Rewards address', address, 'mono']);
  });

  it.each([
    ['the delegator itself', ME],
    ['the delegator in upper case', ME.toUpperCase()],
    ['another address of this wallet', ME2],
  ])('stays normal for %s', async (_, address) => {
    const s = await run([change(address)]);
    expect(s.level).toBe('normal');
    expect(s.dangers).toEqual([]);
  });
});

describe('amounts that are not plain whole numbers', () => {
  const ODD = ['', '0777777777', '010', '0x10', '1_000', '+5'];

  it.each(ODD)('a swap with %j as an amount is not normal', async (amount) => {
    const input = pack(MsgMultiSwap, {
      creator: ME,
      routes: ['pool-bze-usdc'],
      input: { denom: 'ubze', amount },
      minOutput: { denom: USDC, amount: '318200000' },
    });
    const minimum = pack(MsgMultiSwap, {
      creator: ME,
      routes: ['pool-bze-usdc'],
      input: { denom: 'ubze', amount: '1000000000' },
      minOutput: { denom: USDC, amount },
    });
    expect((await run([input])).level).toBe('unknown');
    expect((await run([minimum])).level).toBe('unknown');
  });

  it.each(ODD)(
    'adding or removing liquidity with %j as an amount is not normal',
    async (amount) => {
      const add = (over: object) =>
        pack(MsgAddLiquidity, {
          creator: ME,
          poolId: 'pool-bze-usdc',
          baseAmount: '100000000',
          quoteAmount: '33500000',
          minLpTokens: '5000000000000',
          ...over,
        });
      const remove = (over: object) =>
        pack(MsgRemoveLiquidity, {
          creator: ME,
          poolId: 'pool-bze-usdc',
          lpTokens: '12500000000000',
          minBase: '10000000',
          minQuote: '3350000',
          ...over,
        });
      for (const msg of [
        add({ baseAmount: amount }),
        add({ quoteAmount: amount }),
        add({ minLpTokens: amount }),
        remove({ lpTokens: amount }),
        remove({ minBase: amount }),
        remove({ minQuote: amount }),
      ]) {
        expect((await run([msg])).level).toBe('unknown');
      }
      // An unknown pool shows base units, which must be readable too.
      const unknownPool = add({ poolId: 'pool-nope', baseAmount: amount });
      expect((await run([unknownPool])).level).toBe('unknown');
    },
  );

  it.each(ODD)('a send of %j is not normal', async (amount) => {
    expect((await run([send(ALEX, [{ denom: 'ubze', amount }])])).level).toBe('unknown');
  });

  it('shows a non-plain amount as written, not as a number', async () => {
    const s = await run([
      pack(MsgMultiSwap, {
        creator: ME,
        routes: ['pool-bze-usdc'],
        input: { denom: 'ubze', amount: '1000000000' },
        minOutput: { denom: USDC, amount: '0777777777' },
      }),
    ]);
    expect(JSON.stringify(s)).not.toMatch(/777\.7/);
  });
});
