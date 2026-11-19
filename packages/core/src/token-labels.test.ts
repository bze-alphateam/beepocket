import { describe, expect, it, vi } from 'vitest';
import { stubChain, stubScan } from '../test/stubs';
import {
  summarise,
  TokenResolver,
  type AnyMsg,
  type DenomMetadata,
  type SummaryContext,
  type TxSummary,
} from './index';
import { MsgMultiSwap } from './proto/bze/tradebin/tx';

const ME = 'bze1r5v5srda7xfth3hn2s26txvrcrntldjux0ts9g';
const FAKE = 'factory/bze1x/fake';
const USDC = `ibc/${'AB'.repeat(32)}`;
const ATOM = `ibc/${'5F'.repeat(32)}`;

function setup(fake: DenomMetadata | null, verified = [{ denom: ATOM, symbol: 'ATOM' }]) {
  const chain = stubChain({
    denomMetadata: vi.fn((denom: string) => Promise.resolve(denom === FAKE ? fake : null)),
    denomBranding: vi.fn().mockResolvedValue(null),
    liquidityPools: vi
      .fn()
      .mockResolvedValue([
        { id: 'pool-usdc-fake', base: USDC, quote: FAKE, reserveBase: 1n, reserveQuote: 1n },
      ]),
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
  const tokens = new TokenResolver(chain, scan, {
    verified: { list: () => Promise.resolve(verified) },
  });
  return { chain, tokens };
}

function swap(): AnyMsg {
  const msg = MsgMultiSwap.fromPartial({
    creator: ME,
    routes: ['pool-usdc-fake'],
    input: { denom: USDC, amount: '100000000' },
    minOutput: { denom: FAKE, amount: '5000000000' },
  });
  return { typeUrl: MsgMultiSwap.typeUrl, value: MsgMultiSwap.encode(msg).finish() };
}

function context(tokens: TokenResolver, chain: ReturnType<typeof stubChain>): SummaryContext {
  return {
    tokens,
    markets: chain,
    orders: { marketOrder: () => Promise.resolve(null) },
    addressBook: () => null,
    fees: {
      tradebinParams: () => Promise.reject(new Error('offline')),
      tokenFactoryParams: () => Promise.reject(new Error('offline')),
    },
    ownAddresses: [ME],
  };
}

/** Every piece of text the review shows. */
function texts(s: TxSummary): string[] {
  return [
    s.title,
    s.hero,
    s.sub,
    ...s.rows.flat(),
    ...s.messages.flatMap((m) => [m.title, m.line, m.hero, m.sub, ...m.rows.flat()]),
  ];
}

const meta = (symbol: string, name: string): DenomMetadata => ({
  name,
  symbol,
  display: symbol,
  exponent: 6,
  description: '',
});

describe('labels of tokens that imitate BZE', () => {
  it.each([
    ['BZE', 'BeeZee'],
    ['ΒΖΕ', 'BeeZee'],
    ['ＢＺＥ', 'Fake'],
  ])('a swap into a factory token called %s never reads as plain BZE', async (symbol, name) => {
    const { chain, tokens } = setup(meta(symbol, name));
    const s = await summarise([swap()], context(tokens, chain));
    const all = texts(s).join('\n');
    expect(all).toContain(`${symbol} (look-alike, factory/bze1x/fake)`);
    // Every mention of the symbol carries the marker.
    const bare = all.split(symbol).slice(1);
    expect(bare.length).toBeGreaterThan(0);
    for (const after of bare) expect(after.startsWith(' (look-alike')).toBe(true);
  });

  it('flags a factory token called bze with no symbol of its own', async () => {
    const empty = 'factory/bze1x/bze';
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(meta('', '')),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const tokens = new TokenResolver(chain, stubScan());
    const info = await tokens.resolve(empty);
    expect(info.lookalike).toBe(true);
  });

  it('flags an unverified token that looks like a verified one', async () => {
    const { tokens } = setup(meta('АТОМ', 'Cosmos'));
    expect((await tokens.resolve(FAKE)).lookalike).toBe(true);
  });

  it('leaves the native coin and other tokens exactly as they were', async () => {
    const { tokens } = setup(meta('GOLD', 'Gold'));
    const bze = await tokens.resolve('ubze');
    const gold = await tokens.resolve(FAKE);
    expect(bze).toEqual({
      denom: 'ubze',
      symbol: 'BZE',
      name: 'BeeZee',
      decimals: 6,
      kind: 'native',
      source: 'builtin',
      branding: null,
      logo: null,
    });
    expect('lookalike' in gold).toBe(false);
    expect(gold.symbol).toBe('GOLD');
  });

  it('does not keep the flag in the token cache', async () => {
    const store = new Map<string, unknown>();
    const cache = {
      get: (k: string) => Promise.resolve(store.get(k)),
      set: (k: string, v: unknown) => {
        store.set(k, v);
        return Promise.resolve();
      },
    };
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(meta('BZE', 'BeeZee')),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    await new TokenResolver(chain, stubScan(), { cache }).resolve(FAKE);
    expect(JSON.stringify(store.get(`token:${FAKE}`))).not.toContain('lookalike');
  });
});
