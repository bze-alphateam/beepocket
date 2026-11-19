import type { Cache } from './cache';
import type { VerifiedAsset } from './lookalike';
import {
  SystemClock,
  type Clock,
  type NetworkId,
  type ScanClient,
  type ScanRegistryEntry,
} from './net';
import { stripUnsafeText } from './text';

/** Where the look-alike check gets the verified tokens from. Never fails. */
export interface VerifiedSource {
  list(): Promise<readonly VerifiedAsset[]>;
}

const ibc = (hash: string, symbol: string): VerifiedAsset => ({ denom: `ibc/${hash}`, symbol });

/**
 * The verified tokens the wallet knows without Scan: the non-LP tokens BZE Scan lists as
 * verified, as of this release. Used only while Scan cannot answer and nothing is cached. The
 * native coin is never listed here; it is always known.
 */
export const BUNDLED_VERIFIED: Readonly<Record<NetworkId, readonly VerifiedAsset[]>> = {
  mainnet: [
    { denom: 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl', symbol: 'VDL' },
    { denom: 'factory/bze1972aqfzdg29ugjln74edx0xvcg4ehvysjptk77/CTL', symbol: 'CTL' },
    ibc('02EE50AB3A4B7540FA001B24CB75E688016F65547CABE885EA184338440080B2', 'SHERPA'),
    ibc('062CA1F72787DB36CE8FEA8EC733293215A5554646650A9B92BFA498802A11AA', 'DGN'),
    ibc('08EAEAB525E59C611D5BD8FAC4BE65DF65A69E62874377F6889BBD01A33F385F', 'SPICE'),
    ibc('12C0B8B561AFCFDA3C73DEE0F7F84AA2B860D48493C27E8E81A5D14724FAB08B', 'PHMN.LEGACY.osmosis'),
    ibc('19488A79F091167225A4BFA34BD3D04F11621E682EB14A58B4CA5D6234BA9487', 'PHMN'),
    ibc('5FEB332D2B121921C792F1A0DBF7C3163FF205337B4AFE6E14F69E8E49545F49', 'ATOM'),
    ibc('693DDB2D9B4260D67C8136C22D837F37488E0FBD81857D8E9C6022332EA26E33', 'LMN'),
    ibc('81DA528F4C5546208D1D50F84C2D0B388B45D37AA36FCA622A3CB2D8EF014838', 'USDC.INJ'),
    ibc('82931180F0962712BFABB189083A94C77EA90E269ABFC6D310AF922B2B14E011', 'PHOTON'),
    ibc('9D0AC973BAFA293781F9A86B2911069DF9D8ECE86CDD884F0DE4889AF666B28A', 'INJ'),
    ibc('B2219CA05421EA988F83E5E824BF69362E80A6A87503EFD18B92C91C9E03763D', 'ATONE'),
    ibc('C00D101A3572A5374E23F11944463D1325319E255D7C824B33AF2F927F532348', 'ARCH'),
    ibc('ED07A3391A112B175915CD8FAF43A2DA8E4790EDE12566649D0C2F97716B8518', 'OSMO'),
  ],
  // Testnet Scan verifies only the native coin.
  testnet: [],
};

/** Scan's list is asked again after this long. */
export const VERIFIED_REFRESH_MS = 60 * 60 * 1000;
/** A list older than this is not used, even while Scan is down. */
const VERIFIED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How long a lookup waits for Scan before it uses what it has. */
const VERIFIED_TIMEOUT_MS = 3_000;
/** How long Scan is not asked again after it failed to answer. */
const VERIFIED_RETRY_MS = 60_000;
/** Most entries kept: the list is small, a much longer one is not a list to trust whole. */
const MAX_VERIFIED = 2_000;
const MAX_SYMBOL = 64;
const TIMED_OUT = Symbol('timed out');

interface StoredList {
  fetchedAt: number;
  assets: VerifiedAsset[];
}

function isStoredList(raw: unknown): raw is StoredList {
  if (typeof raw !== 'object' || raw === null) return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.fetchedAt === 'number' &&
    Array.isArray(s.assets) &&
    s.assets.every(
      (a: unknown) =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as Record<string, unknown>).denom === 'string' &&
        typeof (a as Record<string, unknown>).symbol === 'string',
    )
  );
}

export interface VerifiedRegistryOptions {
  cache?: Cache;
  /** Prefix of the cache keys, so one store can serve several networks. */
  cacheKeyPrefix?: string;
  /** Used when Scan cannot answer and no list is cached; none by default. */
  bundled?: readonly VerifiedAsset[];
  clock?: Clock;
}

/**
 * The verified tokens of BZE Scan's registry (`GET /api/v1/registry/assets`), asked at most once
 * an hour and cached. When Scan cannot answer, the last cached list (up to a day old), else the
 * bundled list. One instance asks at most once.
 */
export class VerifiedRegistry implements VerifiedSource {
  private readonly cache: Cache | undefined;
  private readonly key: string;
  private readonly failedKey: string;
  private readonly bundled: readonly VerifiedAsset[];
  private readonly clock: Clock;
  private pending: Promise<readonly VerifiedAsset[]> | undefined;

  constructor(
    private readonly scan: Pick<ScanClient, 'assets'>,
    options: VerifiedRegistryOptions = {},
  ) {
    this.cache = options.cache;
    const prefix = options.cacheKeyPrefix ?? '';
    this.key = `${prefix}verified`;
    this.failedKey = `${prefix}verified-failed`;
    this.bundled = options.bundled ?? [];
    this.clock = options.clock ?? new SystemClock();
  }

  list(): Promise<readonly VerifiedAsset[]> {
    this.pending ??= this.load().catch(() => this.bundled);
    return this.pending;
  }

  private async load(): Promise<readonly VerifiedAsset[]> {
    const now = this.clock.now();
    const raw = await this.cached(this.key);
    const age = isStoredList(raw) ? now - raw.fetchedAt : NaN;
    const stored = isStoredList(raw) && age >= 0 && age < VERIFIED_MAX_AGE_MS ? raw.assets : null;
    if (stored && age < VERIFIED_REFRESH_MS) return stored;
    const fallback = stored ?? this.bundled;

    const failed = await this.cached(this.failedKey);
    if (typeof failed === 'number' && now - failed >= 0 && now - failed < VERIFIED_RETRY_MS) {
      return fallback;
    }

    const answer = await this.ask();
    if (answer === TIMED_OUT) {
      await this.put(this.failedKey, this.clock.now(), VERIFIED_RETRY_MS);
      return fallback;
    }
    const assets = answer
      .filter((a) => a.verified)
      .slice(0, MAX_VERIFIED)
      .map((a) => ({
        denom: a.denom,
        symbol: stripUnsafeText(a.ticker ?? '').slice(0, MAX_SYMBOL),
      }));
    const value: StoredList = { fetchedAt: this.clock.now(), assets };
    await this.put(this.key, value, VERIFIED_MAX_AGE_MS);
    return assets;
  }

  /** Scan's list, or `TIMED_OUT` when it failed or did not answer in time. */
  private async ask(): Promise<ScanRegistryEntry[] | typeof TIMED_OUT> {
    let asked: Promise<ScanRegistryEntry[]>;
    try {
      // Called directly, so an answer that is already there wins over the timeout.
      asked = this.scan.assets();
    } catch (e) {
      asked = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const timedOut = this.clock.sleep(VERIFIED_TIMEOUT_MS).then((): typeof TIMED_OUT => TIMED_OUT);
    return Promise.race([asked, timedOut]).catch((): typeof TIMED_OUT => TIMED_OUT);
  }

  /** A cache read that fails is a miss. */
  private async cached(key: string): Promise<unknown> {
    try {
      return await this.cache?.get(key);
    } catch {
      return undefined;
    }
  }

  /** A cache write that fails only means the next lookup asks again. */
  private async put(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.cache?.set(key, value, ttlMs);
    } catch {
      // nothing kept
    }
  }
}
