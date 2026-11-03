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
  type ScanAsset,
  type ScanClient,
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
      logo: null,
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
    expect(await resolver.resolve('uother/ABCDEF')).toMatchObject({
      kind: 'other',
      source: 'chain',
    });
    expect(await resolver.resolve('uother/123456')).toMatchObject({
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

describe('TokenResolver LP shares', () => {
  // What mainnet answers for the CTL/BZE pool's shares: bank metadata says 6, Scan's registry 12.
  const LP = 'ulp/072C05CF6D235FA4D564EC9B564C1D67614A5A55E67935E1977483F940B85209';
  const LP_IBC = 'ulp_ibc/82931180F0962712BFABB189083A94C77EA90E269ABFC6D310AF922B2B14E011_ubze';
  const bankMeta: DenomMetadata = {
    name: '',
    symbol: '',
    display: `lp/${LP.slice('ulp/'.length)}`,
    exponent: 6,
    description: '',
  };
  const registry: ScanAsset = {
    denom: LP,
    logo: null,
    ticker: 'CTL/BZE LP',
    name: 'CTL/BZE LP Shares',
    decimals: 12,
  };
  function setup(asset: ScanClient['asset']) {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(bankMeta),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const scan = stubScan({ asset: vi.fn(asset) });
    const cache = new MemoryCache();
    return { chain, scan, cache, resolver: new TokenResolver(chain, scan, { cache }) };
  }

  it("takes 12 decimals and the text from Scan's registry, never the chain's 6", async () => {
    const { chain, scan, resolver } = setup(() => Promise.resolve(registry));
    expect(await resolver.resolve(LP)).toEqual({
      denom: LP,
      symbol: 'CTL/BZE LP',
      name: 'CTL/BZE LP Shares',
      decimals: 12,
      kind: 'lp',
      source: 'scan',
      branding: null,
      logo: null,
    });
    expect(chain.denomMetadata).not.toHaveBeenCalled();
    // One registry request serves both the display data and the logo.
    expect(scan.asset).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Scan does not list it', () => Promise.resolve(null)],
    ['Scan is down', () => Promise.reject(new TransportError('offline'))],
    [
      'Scan lists no decimals',
      () => Promise.resolve({ ...registry, denom: LP_IBC, decimals: null }),
    ],
  ])('uses 12 decimals when %s, and does not keep the guess', async (_, asset) => {
    const { cache, resolver } = setup(asset);
    expect(await resolver.resolve(LP_IBC)).toMatchObject({
      kind: 'lp',
      decimals: 12,
      symbol: 'ulp_ibc/829311…',
      source: 'fallback',
    });
    expect(cache.store.has(`token:${LP_IBC}`)).toBe(false);
  });

  it('does not reuse a stored entry from before LP shares had their own kind', async () => {
    const { cache, resolver } = setup(() => Promise.resolve(registry));
    cache.store.set(`token:${LP}`, {
      denom: LP,
      symbol: 'LP/072C05CF6D235FA4D564EC9B564C1D',
      name: 'LP/072C05CF6D235FA4D564EC9B564C1D',
      decimals: 6,
      kind: 'other',
      source: 'chain',
      branding: null,
    });
    expect(await resolver.resolve(LP)).toMatchObject({ kind: 'lp', decimals: 12 });
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
    expect([...cache.store.keys()].sort()).toEqual([`test:logo:${VDL}`, `test:token:${VDL}`]);
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
    expect(cache.store.has(`token:${IBC}`)).toBe(false);
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

describe('TokenResolver logos', () => {
  /** A logo lookup waits this long for Scan; a failed one is not retried for a minute. */
  const LOGO_TIMEOUT_MS = 3_000;
  const LOGO_RETRY_MS = 60_000;
  const LOGO =
    'https://raw.githubusercontent.com/cosmos/chain-registry/master/beezee/images/vdl.png';

  function setup(asset: ScanClient['asset']) {
    const chain = stubChain({
      denomMetadata: vi.fn().mockResolvedValue(vdlMeta),
      denomBranding: vi.fn().mockResolvedValue(null),
    });
    const scan = stubScan({ asset });
    const cache = new MemoryCache();
    // The logo timeout never fires unless a test says so.
    const clock = {
      at: 1_000_000,
      now: () => clock.at,
      sleep: vi.fn<(ms: number) => Promise<void>>(() => new Promise(() => undefined)),
    };
    const resolver = new TokenResolver(chain, scan, {
      cache,
      nativeLogo: '/tokens/bze.png',
      clock,
    });
    return { chain, scan, cache, clock, resolver };
  }

  it("takes the logo from Scan's asset list", async () => {
    const { scan, resolver } = setup(vi.fn().mockResolvedValue({ denom: VDL, logo: LOGO }));
    expect(await resolver.resolve(VDL)).toMatchObject({ symbol: 'VDL', logo: LOGO });
    expect(scan.asset).toHaveBeenCalledWith(VDL);
  });

  it('has no logo when Scan does not list the denom or lists no logo', async () => {
    expect((await setup(vi.fn().mockResolvedValue(null)).resolver.resolve(VDL)).logo).toBeNull();
    const none = setup(vi.fn().mockResolvedValue({ denom: VDL, logo: null }));
    expect((await none.resolver.resolve(VDL)).logo).toBeNull();
  });

  it.each([
    ['plain http', 'http://raw.githubusercontent.com/a/b.png'],
    ['another host', 'https://example.com/b.png'],
    ['a look-alike host', 'https://raw.githubusercontent.com.evil.io/b.png'],
    ['a subdomain of the host', 'https://x.raw.githubusercontent.com/b.png'],
    ['userinfo', 'https://user:pw@raw.githubusercontent.com/b.png'],
    ['a port', 'https://raw.githubusercontent.com:8443/b.png'],
    ['the default port written out', 'https://raw.githubusercontent.com:443/b.png'],
    ['a protocol-relative URL', '//raw.githubusercontent.com/b.png'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:image/png;base64,AAAA'],
    ['garbage', 'not a url'],
    ['an empty string', ''],
    ['the host as userinfo', 'https://raw.githubusercontent.com@evil.io/b.png'],
    ['an upper-case host', 'https://RAW.GITHUBUSERCONTENT.COM/b.png'],
    ['a trailing-dot host', 'https://raw.githubusercontent.com./b.png'],
    ['backslashes', 'https:\\\\raw.githubusercontent.com\\b.png'],
    ['a backslash path', 'https://raw.githubusercontent.com\\@evil.io/b.png'],
    ['leading whitespace', ' https://raw.githubusercontent.com/b.png'],
    ['trailing whitespace', 'https://raw.githubusercontent.com/b.png '],
    ['a tab inside', 'https://raw.githubusercontent.com/b\t.png'],
  ])('drops a logo with %s', async (_, logo) => {
    const { resolver } = setup(vi.fn().mockResolvedValue({ denom: VDL, logo }));
    const info = await resolver.resolve(VDL);
    expect(info.symbol).toBe('VDL');
    expect(info.logo).toBeNull();
  });

  it('does not wait for a slow Scan past the logo timeout, and still caches the token', async () => {
    const t = setup(() => new Promise(() => undefined));
    t.clock.sleep.mockImplementation(() => Promise.resolve());
    expect(await t.resolver.resolve(VDL)).toMatchObject({ symbol: 'VDL', logo: null });
    expect(t.clock.sleep).toHaveBeenCalledWith(LOGO_TIMEOUT_MS);
    expect(t.cache.ttls.get(`token:${VDL}`)).toBe(TOKEN_TTL_MS);
    expect(t.cache.ttls.get(`logo:${VDL}`)).toBe(LOGO_RETRY_MS);
  });

  it('does not ask a failed Scan again for a minute, then picks the logo up', async () => {
    const asset = vi
      .fn()
      .mockRejectedValueOnce(new TransportError('offline'))
      .mockResolvedValue({ denom: VDL, logo: LOGO });
    const t = setup(asset);
    expect(await t.resolver.resolve(VDL)).toMatchObject({ symbol: 'VDL', logo: null });
    t.clock.at += LOGO_RETRY_MS - 1;
    expect((await t.resolver.resolve(VDL)).logo).toBeNull();
    expect(asset).toHaveBeenCalledTimes(1);
    // The token itself was cached despite the failure: the chain is read once.
    expect(t.chain.denomMetadata).toHaveBeenCalledTimes(1);
    t.clock.at += 1;
    expect((await t.resolver.resolve(VDL)).logo).toBe(LOGO);
    expect((await t.resolver.resolve(VDL)).logo).toBe(LOGO);
    expect(asset).toHaveBeenCalledTimes(2);
    expect(t.cache.ttls.get(`logo:${VDL}`)).toBe(TOKEN_TTL_MS);
  });

  it('gives ubze the local logo and never asks Scan, also from the cache', async () => {
    const evil = 'https://raw.githubusercontent.com/evil/bze.png';
    const { scan, resolver } = setup(vi.fn().mockResolvedValue({ denom: 'ubze', logo: evil }));
    expect((await resolver.resolve('ubze')).logo).toBe('/tokens/bze.png');
    expect((await resolver.resolve('ubze')).logo).toBe('/tokens/bze.png');
    expect(scan.asset).not.toHaveBeenCalled();
  });

  it('serves a cached token whatever logo it holds, with the logo from its own lookup', async () => {
    const t = setup(vi.fn().mockResolvedValue({ denom: VDL, logo: LOGO }));
    t.cache.store.set(`token:${VDL}`, {
      denom: VDL,
      symbol: 'VDL',
      name: 'Vidulum',
      decimals: 6,
      kind: 'factory',
      source: 'chain',
      branding: null,
      logo: 'https://example.com/b.png',
    });
    expect(await t.resolver.resolve(VDL)).toMatchObject({ name: 'Vidulum', logo: LOGO });
    expect(t.chain.denomMetadata).not.toHaveBeenCalled();
  });

  it('asks Scan again over a stored logo the filter would refuse', async () => {
    const t = setup(vi.fn().mockResolvedValue({ denom: VDL, logo: LOGO }));
    t.cache.store.set(`logo:${VDL}`, { url: 'https://example.com/b.png' });
    expect((await t.resolver.resolve(VDL)).logo).toBe(LOGO);
    expect(t.scan.asset).toHaveBeenCalledTimes(1);
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
