/* eslint-disable @typescript-eslint/unbound-method -- asserting on vi.fn() stubs */
import { describe, expect, it, vi } from 'vitest';
import brandingTest from '../test/fixtures/rest/testnet/denom-branding.json';
import { MemoryCache, stubChain, stubScan } from '../test/stubs';
import {
  InvalidDenomError,
  TOKEN_TTL_MS,
  TokenResolver,
  TransportError,
  type DenomBranding,
  type DenomMetadata,
  type ScanToken,
} from './index';

const VDL = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl';
const IBC = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2';

const vdlMeta: DenomMetadata = {
  name: 'Vidulum',
  symbol: 'VDL',
  display: 'VDL',
  exponent: 6,
  description: 'Vidulum App Token',
};
const usdc: ScanToken = {
  denom: IBC,
  symbol: 'USDC',
  name: 'USD Coin',
  exponent: 6,
  kind: 'ibc',
  halted: false,
};
// The recorded testnet fixture holds a real brand kit for some denom.
const kit: DenomBranding = brandingTest.body.branding;

describe('TokenResolver.resolve', () => {
  it('knows BZE without asking for metadata or Scan', async () => {
    const chain = stubChain({ denomBranding: vi.fn().mockResolvedValue(null) });
    const scan = stubScan();
    const info = await new TokenResolver(chain, scan).resolve('ubze');
    expect(info).toEqual({
      denom: 'ubze',
      symbol: 'BZE',
      name: 'BeeZee',
      decimals: 6,
      kind: 'native',
      source: 'builtin',
      branding: null,
    });
    expect(chain.denomMetadata).not.toHaveBeenCalled();
    expect(scan.token).not.toHaveBeenCalled();
  });

  it('reads a factory token from bank metadata', async () => {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(vdlMeta),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const info = await new TokenResolver(chain, stubScan()).resolve(VDL);
    expect(info).toMatchObject({
      symbol: 'VDL',
      name: 'Vidulum',
      decimals: 6,
      kind: 'factory',
      source: 'chain',
      branding: null,
    });
    expect(chain.denomMetadata).toHaveBeenCalledWith(VDL);
  });

  it('falls back to the subdenom, upper-cased, when a factory token has no metadata', async () => {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(null),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const info = await new TokenResolver(chain, stubScan()).resolve(VDL);
    expect(info).toMatchObject({ symbol: 'UVDL', name: 'UVDL', decimals: 0, source: 'fallback' });
  });

  it('reads an IBC token from Scan and never asks the chain for its metadata', async () => {
    const chain = stubChain({ denomBranding: vi.fn().mockResolvedValue(null) });
    const scan = stubScan({ token: vi.fn().mockResolvedValue(usdc) });
    const info = await new TokenResolver(chain, scan).resolve(IBC);
    expect(info).toMatchObject({
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      kind: 'ibc',
      source: 'scan',
    });
    expect(chain.denomMetadata).not.toHaveBeenCalled();
  });

  it.each([
    ['Scan is down', () => Promise.reject(new TransportError('offline'))],
    ['Scan does not know the denom', () => Promise.resolve(null)],
  ])('shows an IBC denom shortened when %s', async (_, token) => {
    const chain = stubChain({ denomBranding: vi.fn().mockResolvedValue(null) });
    const info = await new TokenResolver(chain, stubScan({ token: vi.fn(token) })).resolve(IBC);
    expect(info).toMatchObject({
      symbol: 'ibc/27394F…',
      decimals: 0,
      kind: 'ibc',
      source: 'fallback',
    });
  });

  it('keeps the exponent Scan gave when it has no symbol yet', async () => {
    const scan = stubScan({
      token: vi.fn().mockResolvedValue({ ...usdc, symbol: null, name: null, exponent: 8 }),
    });
    const chain = stubChain({ denomBranding: vi.fn().mockResolvedValue(null) });
    const info = await new TokenResolver(chain, scan).resolve(IBC);
    expect(info).toMatchObject({
      symbol: 'ibc/27394F…',
      name: 'ibc/27394F…',
      decimals: 8,
      source: 'scan',
    });
  });

  it('uses the symbol as the name when Scan has no name', async () => {
    const scan = stubScan({ token: vi.fn().mockResolvedValue({ ...usdc, name: null }) });
    const chain = stubChain({ denomBranding: vi.fn().mockResolvedValue(null) });
    expect((await new TokenResolver(chain, scan).resolve(IBC)).name).toBe('USDC');
  });

  it('resolves other denoms from chain metadata, else the fallback', async () => {
    const metadata = vi.fn().mockResolvedValueOnce(vdlMeta).mockResolvedValueOnce(null);
    const chain = stubChain({
      denomMetadata: metadata,
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const resolver = new TokenResolver(chain, stubScan());
    expect(await resolver.resolve('ulp/ABCDEF')).toMatchObject({ kind: 'other', source: 'chain' });
    expect(await resolver.resolve('ulp/123456')).toMatchObject({
      kind: 'other',
      symbol: '123456',
      decimals: 0,
      source: 'fallback',
    });
  });

  it('attaches the brand kit when the chain has one, and null when it has none', async () => {
    const branding = vi.fn().mockResolvedValueOnce(kit).mockResolvedValueOnce(null);
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(vdlMeta),
      denomBranding: branding,
    });
    const resolver = new TokenResolver(chain, stubScan());
    expect((await resolver.resolve(VDL)).branding).toEqual(kit);
    expect((await resolver.resolve(`${VDL}2`)).branding).toBeNull();
  });

  it('cleans and bounds text that token creators control', async () => {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue({
        ...vdlMeta,
        symbol: 'A\u202eB\u0000C',
        name: 'N'.repeat(500),
      }),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const info = await new TokenResolver(chain, stubScan()).resolve(VDL);
    expect(info.symbol).toBe('ABC');
    expect(info.name).toHaveLength(64);
  });

  it.each(['\u200b', '\u200d', '\u2060', '\u00ad', '\ufeff', '\u{e0041}', '\ue000', '\u2028'])(
    'removes the invisible character %j from token text',
    async (char) => {
      const chain = stubChain({
        denomMetadata: vi
          .fn()
          .mockResolvedValue({ ...vdlMeta, symbol: `A${char}B`, name: `N${char}M` }),
        denomBranding: vi.fn().mockResolvedValue(null),
      });
      const info = await new TokenResolver(chain, stubScan()).resolve(VDL);
      expect(info.symbol).toBe('AB');
      expect(info.name).toBe('NM');
    },
  );

  it('keeps the chain exponent but guesses the symbol when it is empty after cleaning', async () => {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue({ ...vdlMeta, symbol: ' \u202e ' }),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    expect(await new TokenResolver(chain, stubScan()).resolve(VDL)).toMatchObject({
      symbol: 'UVDL',
      decimals: 6,
      source: 'chain',
    });
  });

  it.each(['', 'a b', 'x'.repeat(129), '1abc', 'ubze\n', '../x'])(
    'rejects the invalid denom %j before any request',
    async (denom) => {
      const chain = stubChain();
      await expect(new TokenResolver(chain, stubScan()).resolve(denom)).rejects.toBeInstanceOf(
        InvalidDenomError,
      );
    },
  );

  it('lets chain errors through', async () => {
    const chain = stubChain({
      denomMetadata: vi.fn().mockRejectedValue(new TransportError('down')),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    await expect(new TokenResolver(chain, stubScan()).resolve(VDL)).rejects.toBeInstanceOf(
      TransportError,
    );
  });
});

describe('TokenResolver cache', () => {
  function setup() {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(vdlMeta),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const cache = new MemoryCache();
    return { chain, cache, resolver: new TokenResolver(chain, stubScan(), { cache }) };
  }

  it('stores a result for 24 hours and answers the next call without the clients', async () => {
    const { chain, cache, resolver } = setup();
    const first = await resolver.resolve(VDL);
    expect(cache.ttls.get(`token:${VDL}`)).toBe(TOKEN_TTL_MS);
    const second = await resolver.resolve(VDL);
    expect(second).toEqual(first);
    expect(chain.denomMetadata).toHaveBeenCalledTimes(1);
    expect(chain.denomBranding).toHaveBeenCalledTimes(1);
  });

  it('keeps networks apart with the key prefix', async () => {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(vdlMeta),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const cache = new MemoryCache();
    await new TokenResolver(chain, stubScan(), { cache, cacheKeyPrefix: 'test:' }).resolve(VDL);
    expect([...cache.store.keys()]).toEqual([`test:token:${VDL}`]);
  });

  it('does not keep a fallback, so a recovered Scan is picked up', async () => {
    const chain = stubChain({ denomBranding: vi.fn().mockResolvedValue(null) });
    const token = vi
      .fn()
      .mockRejectedValueOnce(new TransportError('offline'))
      .mockResolvedValueOnce(usdc);
    const cache = new MemoryCache();
    const resolver = new TokenResolver(chain, stubScan({ token }), { cache });
    expect((await resolver.resolve(IBC)).source).toBe('fallback');
    expect(cache.store.size).toBe(0);
    expect((await resolver.resolve(IBC)).source).toBe('scan');
  });

  it.each([
    ['junk', 'oops'],
    ['another denom', { denom: 'ubze' }],
    [
      'a bad decimals value',
      {
        denom: VDL,
        symbol: 'X',
        name: 'X',
        decimals: 99,
        kind: 'factory',
        source: 'chain',
        branding: null,
      },
    ],
    [
      'a stored fallback',
      {
        denom: VDL,
        symbol: 'X',
        name: 'X',
        decimals: 0,
        kind: 'factory',
        source: 'fallback',
        branding: null,
      },
    ],
  ])('ignores a cache entry that is %s', async (_, entry) => {
    const { chain, cache, resolver } = setup();
    cache.store.set(`token:${VDL}`, entry);
    expect((await resolver.resolve(VDL)).symbol).toBe('VDL');
    expect(chain.denomMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('TokenResolver.tokenCodeExists', () => {
  it('is true only with a positive supply', async () => {
    const supply = vi.fn().mockResolvedValueOnce(5n).mockResolvedValueOnce(0n);
    const resolver = new TokenResolver(stubChain({ supply }), stubScan());
    expect(await resolver.tokenCodeExists(VDL)).toBe(true);
    expect(await resolver.tokenCodeExists('factory/bze1x/unone')).toBe(false);
    expect(supply).toHaveBeenNthCalledWith(1, VDL);
  });

  it('refuses an invalid denom', async () => {
    await expect(
      new TokenResolver(stubChain(), stubScan()).tokenCodeExists('bad denom'),
    ).rejects.toBeInstanceOf(InvalidDenomError);
  });
});
