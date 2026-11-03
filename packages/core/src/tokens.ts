import type { Cache } from './cache';
import { stripUnsafeText } from './text';
import { TOKEN_TTL_MS } from './cache';
import type { ChainClient, DenomBranding, ScanClient } from './net';

export type Branding = DenomBranding;

export type TokenKind = 'native' | 'factory' | 'ibc' | 'other';

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

const MAX_DENOM_LENGTH = 128;
const DENOM_PATTERN = /^[A-Za-z][A-Za-z0-9/:._-]*$/;
const MAX_SYMBOL_LENGTH = 32;
const MAX_NAME_LENGTH = 64;
/** The only host token logos are loaded from (the chain registry's files). */
const LOGO_HOST = 'raw.githubusercontent.com';
const MAX_LOGO_LENGTH = 2048;

function kindOf(denom: string): TokenKind {
  if (denom === NATIVE_DENOM) return 'native';
  if (denom.startsWith('factory/')) return 'factory';
  if (denom.startsWith('ibc/')) return 'ibc';
  return 'other';
}

/** Display text from an untrusted source: no control characters, bounded; null when nothing is left. */
function cleanText(raw: string, max: number): string | null {
  const text = stripUnsafeText(raw).trim().slice(0, max).trim();
  return text === '' ? null : text;
}

function fallbackSymbol(denom: string, kind: TokenKind): string {
  if (kind === 'ibc') return `${denom.slice(0, 'ibc/'.length + 6)}…`;
  const last = denom.split('/').pop() ?? '';
  return (cleanText(last, MAX_SYMBOL_LENGTH) ?? denom.slice(0, MAX_SYMBOL_LENGTH)).toUpperCase();
}

/**
 * A logo URL from Scan, kept only when it is plain `https://raw.githubusercontent.com/…`: no
 * other host or look-alike, no userinfo, no port. Anything else means no logo.
 */
function safeLogo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LOGO_LENGTH) return null;
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
    (branding === null || typeof branding === 'object') &&
    // Entries cached before logos existed lack the field: read those again.
    (t.logo === null ||
      (typeof t.logo === 'string' && (denom === NATIVE_DENOM || safeLogo(t.logo) === t.logo)))
  );
}

export interface TokenResolverOptions {
  cache?: Cache;
  /** Prefix of every cache key, so one store can serve several networks. */
  cacheKeyPrefix?: string;
  /** The logo of ubze, a URL of the wallet's own (Scan is never asked); none by default. */
  nativeLogo?: string;
}

/** Name, symbol, decimals and brand kit of any denom. */
export class TokenResolver {
  private readonly cache: Cache | undefined;
  private readonly prefix: string;
  private readonly nativeLogo: string | null;

  constructor(
    private readonly chain: ChainClient,
    private readonly scan: ScanClient,
    options: TokenResolverOptions = {},
  ) {
    this.cache = options.cache;
    this.prefix = options.cacheKeyPrefix ?? '';
    this.nativeLogo = options.nativeLogo ?? null;
  }

  /**
   * Chain errors propagate; a missing or unreachable Scan only degrades to the fallback and to
   * no logo.
   */
  async resolve(denom: string): Promise<TokenInfo> {
    assertDenom(denom);
    const kind = kindOf(denom);
    const key = `${this.prefix}token:${denom}`;
    const cached = await this.cache?.get(key);
    if (isTokenInfo(cached, denom)) {
      // ubze's logo is the wallet's own file, never a stored value.
      return kind === 'native' ? { ...cached, logo: this.nativeLogo } : cached;
    }

    const [display, branding, logo] = await Promise.all([
      this.displayData(denom, kind),
      this.chain.denomBranding(denom),
      this.logo(denom, kind),
    ]);
    const info: TokenInfo = { denom, kind, ...display, branding, logo: logo.url };
    // A fallback is a guess (and often a symptom of Scan being down), and so is "no logo" when
    // Scan did not answer: never keep either.
    if (info.source !== 'fallback' && logo.answered) {
      await this.cache?.set(key, info, TOKEN_TTL_MS);
    }
    return info;
  }

  /** True when the denom has any supply on chain. */
  async tokenCodeExists(denom: string): Promise<boolean> {
    assertDenom(denom);
    return (await this.chain.supply(denom)) > 0n;
  }

  /** `answered` is false when Scan could not be asked; ubze never asks it. */
  private async logo(
    denom: string,
    kind: TokenKind,
  ): Promise<{ url: string | null; answered: boolean }> {
    if (kind === 'native') return { url: this.nativeLogo, answered: true };
    try {
      const asset = await this.scan.asset(denom);
      return { url: safeLogo(asset?.logo), answered: true };
    } catch {
      return { url: null, answered: false };
    }
  }

  private async displayData(
    denom: string,
    kind: TokenKind,
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
    return { symbol, name: symbol, decimals: 0, source: 'fallback' };
  }
}

function assertDenom(denom: string): void {
  if (denom.length > MAX_DENOM_LENGTH || !DENOM_PATTERN.test(denom))
    throw new InvalidDenomError('not a valid denom');
}
