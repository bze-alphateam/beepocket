import type { Cache } from './cache';
import { stripUnsafeText } from './text';
import { TOKEN_TTL_MS } from './cache';
import {
  SystemClock,
  type ChainClient,
  type Clock,
  type DenomBranding,
  type ScanAsset,
  type ScanClient,
} from './net';

export type Branding = DenomBranding;

/** `lp`: tradebin pool shares (`ulp/…`, `ulp_…`). */
export type TokenKind = 'native' | 'factory' | 'ibc' | 'lp' | 'other';

/** Where the display data came from; `fallback` means it is a guess from the denom. */
export type TokenSource = 'builtin' | 'chain' | 'scan' | 'fallback';

export interface TokenInfo {
  denom: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: TokenKind;
  source: TokenSource;
  branding: Branding | null;
  /**
   * Logo image URL: for ubze the wallet's own copy, otherwise an `https://raw.githubusercontent.com/`
   * URL from Scan's asset list. Null shows the letter avatar.
   */
  logo: string | null;
}

/** The denom is not something a chain could hold (too long, odd characters). */
export class InvalidDenomError extends Error {
  override readonly name = 'InvalidDenomError';
}

export const NATIVE_DENOM = 'ubze';
/** Decimals of every LP share token. The chain's bank metadata says 6, which is wrong. */
export const LP_DECIMALS = 12;

const MAX_DENOM_LENGTH = 128;
const DENOM_PATTERN = /^[A-Za-z][A-Za-z0-9/:._-]*$/;
const MAX_SYMBOL_LENGTH = 32;
const MAX_NAME_LENGTH = 64;
/** The only host token logos are loaded from (the chain registry's files). */
const LOGO_HOST = 'raw.githubusercontent.com';
const MAX_LOGO_LENGTH = 2048;
/** Whitespace, control characters and backslashes, which URL parsing would quietly drop or fix. */
const LOGO_UNSAFE_CHARS = /[\s\p{Cc}\\]/u;
/** How long a token waits for its logo; past this it shows without one. */
const LOGO_TIMEOUT_MS = 3_000;
/** Scan did not answer a logo lookup in time, or failed. */
const TIMED_OUT = Symbol('timed out');
/** How long Scan is not asked again for a logo after it failed to answer. */
const LOGO_RETRY_MS = 60_000;

function kindOf(denom: string): TokenKind {
  if (denom === NATIVE_DENOM) return 'native';
  if (denom.startsWith('factory/')) return 'factory';
  if (denom.startsWith('ibc/')) return 'ibc';
  if (denom.startsWith('ulp/') || denom.startsWith('ulp_')) return 'lp';
  return 'other';
}

/** Display text from an untrusted source: no control characters, bounded; null when nothing is left. */
function cleanText(raw: string, max: number): string | null {
  const text = stripUnsafeText(raw).trim().slice(0, max).trim();
  return text === '' ? null : text;
}

function fallbackSymbol(denom: string, kind: TokenKind): string {
  if (kind === 'ibc') return `${denom.slice(0, 'ibc/'.length + 6)}…`;
  if (kind === 'lp') return `${denom.slice(0, denom.indexOf('/') + 1 + 6)}…`;
  const last = denom.split('/').pop() ?? '';
  return (cleanText(last, MAX_SYMBOL_LENGTH) ?? denom.slice(0, MAX_SYMBOL_LENGTH)).toUpperCase();
}

/**
 * A logo URL from Scan, kept only when it is plain `https://raw.githubusercontent.com/…`: no
 * other host or look-alike, no userinfo, no port. Anything else means no logo.
 */
function safeLogo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LOGO_LENGTH || LOGO_UNSAFE_CHARS.test(raw)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const plain =
    url.protocol === 'https:' &&
    url.hostname === LOGO_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    // `https://raw.githubusercontent.com:443/` parses with an empty port: keep the URL as written.
    raw.startsWith(`https://${LOGO_HOST}/`);
  return plain ? url.href : null;
}

function isTokenInfo(value: unknown, denom: string): value is TokenInfo {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  const branding = t.branding;
  return (
    t.denom === denom &&
    typeof t.symbol === 'string' &&
    typeof t.name === 'string' &&
    typeof t.decimals === 'number' &&
    Number.isInteger(t.decimals) &&
    t.decimals >= 0 &&
    t.decimals <= 18 &&
    t.kind === kindOf(denom) &&
    (t.source === 'builtin' || t.source === 'chain' || t.source === 'scan') &&
    (branding === null || typeof branding === 'object')
  );
}

/** A stored logo answer: Scan's (filtered) URL, or the time Scan last failed to answer. */
type StoredLogo = { url: string | null } | { failedAt: number };

function isStoredLogo(value: unknown): value is StoredLogo {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if ('url' in v) return v.url === null || (typeof v.url === 'string' && safeLogo(v.url) === v.url);
  return typeof v.failedAt === 'number';
}

export interface TokenResolverOptions {
  cache?: Cache;
  /** Prefix of every cache key, so one store can serve several networks. */
  cacheKeyPrefix?: string;
  /** The logo of ubze, a URL of the wallet's own (Scan is never asked); none by default. */
  nativeLogo?: string;
  /** Times the logo lookup and its retry; the system clock by default. */
  clock?: Clock;
}

/** Name, symbol, decimals and brand kit of any denom. */
export class TokenResolver {
  private readonly cache: Cache | undefined;
  private readonly prefix: string;
  private readonly nativeLogo: string | null;
  private readonly clock: Clock;

  constructor(
    private readonly chain: ChainClient,
    private readonly scan: ScanClient,
    options: TokenResolverOptions = {},
  ) {
    this.cache = options.cache;
    this.prefix = options.cacheKeyPrefix ?? '';
    this.nativeLogo = options.nativeLogo ?? null;
    this.clock = options.clock ?? new SystemClock();
  }

  /**
   * Chain errors propagate; a missing or unreachable Scan only degrades to the fallback and to
   * no logo. The logo is looked up alongside and never holds the rest up past `LOGO_TIMEOUT_MS`.
   */
  async resolve(denom: string): Promise<TokenInfo> {
    assertDenom(denom);
    const kind = kindOf(denom);
    // The logo and an LP token's display data come from the same Scan answer: ask once.
    let asked: Promise<ScanAsset | null> | undefined;
    // Async, so even a client that throws on the spot is a rejected promise.
    const asset = () => (asked ??= (async () => this.scan.asset(denom))());
    const logo = this.logo(denom, kind, asset);
    const [info, url] = await Promise.all([this.info(denom, kind, asset), logo]);
    return { ...info, logo: url };
  }

  /** Everything but the logo, cached on its own. */
  private async info(
    denom: string,
    kind: TokenKind,
    asset: () => Promise<ScanAsset | null>,
  ): Promise<Omit<TokenInfo, 'logo'>> {
    const key = `${this.prefix}token:${denom}`;
    const cached = await this.cache?.get(key);
    if (isTokenInfo(cached, denom)) return cached;

    const [display, branding] = await Promise.all([
      this.displayData(denom, kind, asset),
      this.chain.denomBranding(denom),
    ]);
    const info = { denom, kind, ...display, branding };
    // A fallback is a guess (and often a symptom of Scan being down): never keep it.
    if (info.source !== 'fallback') await this.cache?.set(key, info, TOKEN_TTL_MS);
    return info;
  }

  /** True when the denom has any supply on chain. */
  async tokenCodeExists(denom: string): Promise<boolean> {
    assertDenom(denom);
    return (await this.chain.supply(denom)) > 0n;
  }

  /**
   * ubze never asks Scan. Scan's answer is kept for the token TTL; a failure or a timeout means
   * no logo, and Scan is not asked again for `LOGO_RETRY_MS`.
   */
  private async logo(
    denom: string,
    kind: TokenKind,
    asset: () => Promise<ScanAsset | null>,
  ): Promise<string | null> {
    if (kind === 'native') return this.nativeLogo;
    const key = `${this.prefix}logo:${denom}`;
    const stored = await this.cache?.get(key);
    if (isStoredLogo(stored)) {
      if ('url' in stored) return stored.url;
      const since = this.clock.now() - stored.failedAt;
      if (since >= 0 && since < LOGO_RETRY_MS) return null;
    }

    const timedOut = this.clock.sleep(LOGO_TIMEOUT_MS).then((): typeof TIMED_OUT => TIMED_OUT);
    const answer = await Promise.race([asset(), timedOut]).catch((): typeof TIMED_OUT => TIMED_OUT);
    if (answer === TIMED_OUT) {
      await this.cache?.set(key, { failedAt: this.clock.now() }, LOGO_RETRY_MS);
      return null;
    }
    const url = safeLogo(answer?.logo);
    await this.cache?.set(key, { url }, TOKEN_TTL_MS);
    return url;
  }

  private async displayData(
    denom: string,
    kind: TokenKind,
    asset: () => Promise<ScanAsset | null>,
  ): Promise<Pick<TokenInfo, 'symbol' | 'name' | 'decimals' | 'source'>> {
    if (kind === 'native') return { symbol: 'BZE', name: 'BeeZee', decimals: 6, source: 'builtin' };

    // Decimals from a source that answered are authoritative even when its text is
    // unusable: guessing 0 would show wrong amounts. Only the text falls back.
    let found: { symbol: string | null; name: string | null; decimals: number } | null;
    let source: TokenSource;
    if (kind === 'ibc') {
      // The chain only holds a placeholder for IBC denoms; Scan has the real data.
      const token = await this.scan.token(denom).catch(() => null);
      found = token && {
        symbol: token.symbol && cleanText(token.symbol, MAX_SYMBOL_LENGTH),
        name: token.name && cleanText(token.name, MAX_NAME_LENGTH),
        decimals: token.exponent,
      };
      source = 'scan';
    } else if (kind === 'lp') {
      // The chain's metadata has 6 decimals and no text for LP shares; Scan's registry has both right.
      const entry = await asset().catch(() => null);
      found =
        entry && entry.decimals !== null
          ? {
              symbol: entry.ticker && cleanText(entry.ticker, MAX_SYMBOL_LENGTH),
              name: entry.name && cleanText(entry.name, MAX_NAME_LENGTH),
              decimals: entry.decimals,
            }
          : null;
      source = 'scan';
    } else {
      const meta = await this.chain.denomMetadata(denom);
      found = meta && {
        symbol: cleanText(meta.symbol, MAX_SYMBOL_LENGTH),
        name: cleanText(meta.name, MAX_NAME_LENGTH),
        decimals: meta.exponent,
      };
      source = 'chain';
    }
    if (found) {
      const symbol = found.symbol ?? fallbackSymbol(denom, kind);
      return { symbol, name: found.name ?? symbol, decimals: found.decimals, source };
    }

    const symbol = fallbackSymbol(denom, kind);
    return { symbol, name: symbol, decimals: kind === 'lp' ? LP_DECIMALS : 0, source: 'fallback' };
  }
}

function assertDenom(denom: string): void {
  if (denom.length > MAX_DENOM_LENGTH || !DENOM_PATTERN.test(denom))
    throw new InvalidDenomError('not a valid denom');
}
