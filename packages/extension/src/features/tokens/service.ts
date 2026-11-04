import {
  InvalidDenomError,
  LP_DECIMALS,
  NATIVE_DENOM,
  type TokenResolver,
  type Cache,
  type ChainClient,
  type Clock,
  type DenomBranding,
  type NetworkId,
  type ScanClient,
  type TokenInfo,
} from '@beepocket/core';
import type { SessionStorage } from '../../platform';
import {
  TokenErrorCodes,
  type AddressBalance,
  type ListedToken,
  type TokenBalances,
  type TokenSearch,
} from '../../protocol/tokens';
import { fail, ok, type Result } from '../../protocol';
import type { PreferredTokensStore, WalletAddresses } from './ports';
import { BZE_LOGO, createTokenResolver } from './resolver';

/**
 * How long a balance read is reused: under Home's 4 s poll, so every poll asks the node while a
 * token switch or the switcher right after a poll reuses it. The UI forces a refresh when it needs one.
 */
export const BALANCE_FRESH_MS = 3_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_QUERY_LENGTH = 128;

export interface TokenServiceDeps {
  network: NetworkId;
  chain: ChainClient;
  scan: ScanClient;
  cache: Cache;
  session: SessionStorage;
  clock: Pick<Clock, 'now'>;
  preferred: PreferredTokensStore;
  addresses: WalletAddresses;
}

interface StoredBalances {
  at: number;
  /** denom → base units, decimal string */
  balances: Record<string, string>;
}

function isStoredBalances(raw: unknown): raw is StoredBalances {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'at' in raw &&
    typeof raw.at === 'number' &&
    'balances' in raw &&
    typeof raw.balances === 'object' &&
    raw.balances !== null
  );
}

/** Everything the popup knows about tokens, for one network. Built per request; holds no state. */
export class TokenService {
  private readonly resolver: TokenResolver;

  constructor(private readonly deps: TokenServiceDeps) {
    this.resolver = createTokenResolver(deps, deps.network);
  }

  async lookup(code: string): Promise<Result<TokenInfo>> {
    try {
      if (code !== NATIVE_DENOM && !(await this.resolver.tokenCodeExists(code))) {
        return noSuchToken();
      }
      return ok(await this.resolver.resolve(code));
    } catch (e) {
      if (e instanceof InvalidDenomError) return invalidCode();
      throw e;
    }
  }

  async preferred(): Promise<Result<ListedToken[]>> {
    return ok(await this.resolveAll(await this.deps.preferred.get(this.deps.network)));
  }

  async add(denom: string): Promise<Result<ListedToken[]>> {
    const found = await this.lookup(denom);
    if (!found.ok) return found;
    const current = await this.deps.preferred.get(this.deps.network);
    if (!current.includes(denom)) {
      const saved = await this.deps.preferred.set(this.deps.network, [...current, denom]);
      if (!saved.ok) return saved;
    }
    return this.preferred();
  }

  async remove(denom: string): Promise<Result<ListedToken[]>> {
    const current = await this.deps.preferred.get(this.deps.network);
    if (!current.includes(denom)) return this.preferred();
    if (current.length === 1) {
      return fail(TokenErrorCodes.lastToken, 'At least one token must stay in the list.');
    }
    const saved = await this.deps.preferred.set(
      this.deps.network,
      current.filter((d) => d !== denom),
    );
    return saved.ok ? this.preferred() : saved;
  }

  /**
   * Every held denom is findable: the query filters first, only the answer is capped. An address
   * that cannot be read adds nothing (ubze stays) and makes the answer `partial`.
   */
  async search(query: string): Promise<Result<TokenSearch>> {
    const needle = query.trim().slice(0, MAX_QUERY_LENGTH).toLowerCase();
    const held = new Set<string>([NATIVE_DENOM]);
    let partial = false;
    for (const entry of await this.storedBalances(false)) {
      if (!entry) {
        partial = true;
        continue;
      }
      for (const [denom, amount] of Object.entries(entry.balances)) {
        if (BigInt(amount) > 0n) held.add(denom);
      }
    }
    const tokens = await this.resolveAll([...held]);
    return ok({
      tokens: tokens
        .filter(
          (t) =>
            needle === '' ||
            t.symbol.toLowerCase().includes(needle) ||
            t.name.toLowerCase().includes(needle) ||
            t.denom.toLowerCase().includes(needle),
        )
        .slice(0, MAX_SEARCH_RESULTS),
      partial,
    });
  }

  /** An address that cannot be read is reported as `failed` and makes the total `partial`. */
  async balances(denom: string, refresh: boolean): Promise<Result<TokenBalances>> {
    const addresses = await this.deps.addresses.list(this.deps.network);
    return ok(balancesOf(denom, addresses, await this.storedBalances(refresh, addresses)));
  }

  /**
   * The last read of every address, however old, without asking the node: what Home shows at
   * once while it reads again. `null` when some address has never been read.
   */
  async lastBalances(denom: string): Promise<Result<TokenBalances | null>> {
    const addresses = await this.deps.addresses.list(this.deps.network);
    const stored = await Promise.all(
      addresses.map(async ({ address }) => {
        const raw = await this.deps.session.get(this.balancesKey(address));
        return isStoredBalances(raw) ? raw : null;
      }),
    );
    if (stored.some((entry) => entry === null)) return ok(null);
    return ok(balancesOf(denom, addresses, stored));
  }

  async theme(denom: string): Promise<Result<DenomBranding | null>> {
    if (denom === NATIVE_DENOM) return ok(null);
    const found = await this.lookup(denom);
    return found.ok ? ok(found.value.branding) : found;
  }

  /** A denom that cannot be resolved right now stays in the list as a flagged placeholder. */
  private async resolveAll(denoms: string[]): Promise<ListedToken[]> {
    const settled = await Promise.allSettled(denoms.map((d) => this.resolver.resolve(d)));
    return settled.map((s, i) =>
      s.status === 'fulfilled' ? s.value : unresolved(denoms[i] ?? ''),
    );
  }

  private balancesKey(address: string): string {
    return `balances:${this.deps.network}:${address}`;
  }

  /** One entry per address, in order (`null` when it could not be read); read-through with `BALANCE_FRESH_MS`. */
  private async storedBalances(
    refresh: boolean,
    addresses?: Awaited<ReturnType<WalletAddresses['list']>>,
  ): Promise<(StoredBalances | null)[]> {
    const list = addresses ?? (await this.deps.addresses.list(this.deps.network));
    const settled = await Promise.allSettled(
      list.map(async ({ address }) => {
        const key = this.balancesKey(address);
        const now = this.deps.clock.now();
        if (!refresh) {
          const raw = await this.deps.session.get(key);
          if (isStoredBalances(raw) && now - raw.at >= 0 && now - raw.at < BALANCE_FRESH_MS) {
            return raw;
          }
        }
        const fetched = await this.deps.chain.balances(address);
        const entry: StoredBalances = {
          at: now,
          balances: Object.fromEntries([...fetched].map(([d, a]) => [d, a.toString()])),
        };
        await this.deps.session.set(key, entry);
        return entry;
      }),
    );
    return settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
  }
}

function balancesOf(
  denom: string,
  addresses: Awaited<ReturnType<WalletAddresses['list']>>,
  stored: (StoredBalances | null)[],
): TokenBalances {
  let total = 0n;
  let partial = false;
  const rows = addresses.map((a, i): AddressBalance => {
    const entry = stored[i];
    if (!entry) {
      partial = true;
      return { index: a.index, address: a.address, amount: '0', failed: true };
    }
    const held = Object.hasOwn(entry.balances, denom) ? entry.balances[denom] : undefined;
    const amount = BigInt(held ?? '0');
    total += amount;
    return { index: a.index, address: a.address, amount: amount.toString() };
  });
  return { denom, addresses: rows, total: total.toString(), partial };
}

function kindOf(denom: string): TokenInfo['kind'] {
  if (denom === NATIVE_DENOM) return 'native';
  if (denom.startsWith('factory/')) return 'factory';
  if (denom.startsWith('ibc/')) return 'ibc';
  if (denom.startsWith('ulp/') || denom.startsWith('ulp_')) return 'lp';
  return 'other';
}

function unresolved(denom: string): ListedToken {
  const symbol = (denom.split('/').pop() ?? denom).slice(0, 32).toUpperCase();
  const kind = kindOf(denom);
  return {
    denom,
    symbol,
    name: symbol,
    decimals: kind === 'lp' ? LP_DECIMALS : 0,
    kind,
    source: 'fallback',
    branding: null,
    logo: denom === NATIVE_DENOM ? BZE_LOGO : null,
    unresolved: true,
  };
}

function noSuchToken(): Result<never> {
  return fail(TokenErrorCodes.noSuchToken, 'No token with this code on BeeZee');
}

function invalidCode(): Result<never> {
  return fail(TokenErrorCodes.invalidCode, 'This is not a valid token code.');
}
