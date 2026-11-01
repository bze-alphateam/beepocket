import { describe, expect, it, vi } from 'vitest';
import { stubChain, stubScan } from '../test/stubs';
import {
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
import { MsgSend } from './proto/cosmos/bank/v1beta1/tx';
import { BasicAllowance, PeriodicAllowance } from './proto/cosmos/feegrant/v1beta1/feegrant';
import { MsgGrantAllowance } from './proto/cosmos/feegrant/v1beta1/tx';
import { VoteOption } from './proto/cosmos/gov/v1/gov';
import { MsgVote } from './proto/cosmos/gov/v1/tx';
import { MsgFundBurner, MsgJoinRaffle } from './proto/bze/burner/tx';
import {
  MsgAddLiquidity,
  MsgCancelOrder,
  MsgCreateOrder,
  MsgFillOrders,
  MsgMultiSwap,
  MsgRemoveLiquidity,
} from './proto/bze/tradebin/tx';
import { Any } from './proto/google/protobuf/any';

const ME = 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g';
const ALEX = 'bze1q8t5x0yvl9jzx5pq4m3vvrmkz8cndhqky4x4kf';
const STRANGER = 'bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p';
const VDL = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl';
const USDC = `ibc/${'AB'.repeat(32)}`;

const BZE_USDC: Market = { id: `ubze/${USDC}`, base: 'ubze', quote: USDC };
const VDL_BZE: Market = { id: `${VDL}/ubze`, base: VDL, quote: 'ubze' };
const MARKETS = [BZE_USDC, VDL_BZE];

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
  });
  const scan = stubScan({
    token: vi.fn((denom: string) =>
      Promise.resolve(
        denom === USDC
          ? { denom, symbol: 'USDC', name: 'USD Coin', exponent: 6, kind: 'ibc', halted: false }
          : null,
      ),
    ),
  });
  return {
    tokens: new TokenResolver(chain, scan),
    markets: chain,
    orders: chain,
    addressBook: (a) => (a === ALEX ? 'Alex' : null),
    ...overrides,
  };
}

const run = (messages: AnyMsg[], overrides: Partial<SummaryContext> = {}) =>
  summarise(messages, context(overrides));
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
const delegate: AnyMsg = {
  typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
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
    ]);
    expect(s.level).toBe('normal');
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
  const fill = (
    orderType: string,
    items = [
      { price: '0.3', amount: '100000000' },
      { price: '0.31', amount: '50000000' },
    ],
  ) => pack(MsgFillOrders, { creator: ME, marketId: BZE_USDC.id, orderType, orders: items });

  it('counts the orders, sums the amount and names the side the signer takes', async () => {
    const s = await run([fill('sell')]);
    expect(headline(s)).toBe('Fill orders · 2 orders · BZE/USDC · you buy');
    expect(s.rows).toEqual([
      ['Market', 'BZE/USDC'],
      ['Total amount', '150.00 BZE'],
    ]);
    expect((await run([fill('buy')])).sub).toBe('BZE/USDC · you sell');
  });

  it('uses the singular for one order', async () => {
    expect((await run([fill('sell', [{ price: '1', amount: '1' }])])).hero).toBe('1 order');
  });

  it('is unknown when an item is unreadable or the type is not buy/sell', async () => {
    expect((await run([fill('sell', [{ price: '1', amount: 'x' }])])).level).toBe('unknown');
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
        minLpTokens: '5000000',
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
        lpTokens: '12500000',
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
    const exec = pack(MsgExec, { grantee: ME, msgs: [Any.fromPartial(send())] });
    const s = await run([exec]);
    expect(s.level).toBe('dangerous');
    expect(s.hero).toBe('1 message');
    expect(s.rows[1]).toEqual(['Messages', 'MsgSend']);
    expect(s.dangers).toHaveLength(1);
  });

  it('keeps a grant dangerous even when its bytes are broken', async () => {
    const broken: AnyMsg = { typeUrl: MsgGrant.typeUrl, value: new Uint8Array([10, 99]) };
    expect((await run([broken])).level).toBe('dangerous');
  });
});

describe('unknown messages', () => {
  it('shows the last segment of the type url and nothing else', async () => {
    const s = await run([delegate]);
    expect(s.level).toBe('unknown');
    expect(s.title).toBe('MsgDelegate');
    expect(s.hero).toBe('Unknown message');
    expect(s.sub).toBe('/cosmos.staking.v1beta1.MsgDelegate');
    expect(s.rows).toEqual([]);
    expect(s.messages[0]).toMatchObject({ level: 'unknown', icon: 'unknown' });
  });

  it('treats a known type with unreadable bytes as unknown', async () => {
    const broken: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    const s = await run([broken]);
    expect(s.level).toBe('unknown');
    expect(s.sub).toContain('unreadable');
  });

  it('makes invisible characters visible', async () => {
    const sneaky: AnyMsg = { typeUrl: '/x.v1.Msg‮Evil', value: new Uint8Array() };
    const s = await run([sneaky]);
    expect(s.title).not.toMatch(/‮/);
    expect(s.title).toContain('�');
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
    expect((await run([send(), delegate])).level).toBe('unknown');
    expect((await run([send(), delegate, grant()])).level).toBe('dangerous');
    expect((await run([grant(), send()])).level).toBe('dangerous');
    expect((await run([delegate, send()])).level).toBe('unknown');
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
    expect(s.level).toBe('normal');
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

describe('rawJson', () => {
  it('pretty-prints decoded messages, expiry included', () => {
    const json = rawJson([send(), grant(new Date('2027-03-04T05:06:07Z'))]);
    const parsed = JSON.parse(json) as { typeUrl: string; value: Record<string, unknown> }[];
    expect(parsed.map((m) => m.typeUrl)).toEqual([MsgSend.typeUrl, MsgGrant.typeUrl]);
    expect(json).toContain('\n  ');
    expect(json).toContain('2027-03-04T05:06:07.000Z');
  });

  it('keeps the bytes of a message it cannot decode', () => {
    const parsed = JSON.parse(rawJson([delegate])) as unknown;
    expect(parsed).toEqual([{ typeUrl: delegate.typeUrl, unknown: true, value: 'AQID' }]);
  });

  it('shows bytes that do not decode as their type', () => {
    const broken: AnyMsg = { typeUrl: MsgSend.typeUrl, value: new Uint8Array([10, 99]) };
    expect(JSON.parse(rawJson([broken]))).toEqual([
      { typeUrl: MsgSend.typeUrl, unknown: true, value: 'CmM=' },
    ]);
  });
});
