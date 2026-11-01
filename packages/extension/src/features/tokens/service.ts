import {
  InvalidDenomError,
  NATIVE_DENOM,
  TokenResolver,
  type Cache,
  type ChainClient,
  type Clock,
  type DenomBranding,
  type NetworkId,
  type ScanClient,
  type TokenInfo,
} from '@beepocket/core';
import type { SessionStorage } from '../../platform';
import { TokenErrorCodes, type TokenBalances } from '../../protocol/tokens';
import { fail, ok, type Result } from '../../protocol';
import type { PreferredTokensStore, WalletAddresses } from './ports';

/** How long a balance read is reused; the UI forces a refresh when it needs a fresh one. */
export const BALANCE_FRESH_MS = 10_000;
const MAX_SEARCH_CANDIDATES = 100;
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
    // Keys carry the network id so a network switch never reads the other network's data.
    this.resolver = new TokenResolver(deps.chain, deps.scan, {
      cache: deps.cache,
      cacheKeyPrefix: `${deps.network}:`,
    });
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

  async preferred(): Promise<Result<TokenInfo[]>> {
    return ok(await this.resolveAll(await this.deps.preferred.get(this.deps.network)));
  }

  async add(denom: string): Promise<Result<TokenInfo[]>> {
    const found = await this.lookup(denom);
    if (!found.ok) return found;
    const current = await this.deps.preferred.get(this.deps.network);
    if (!current.includes(denom)) {
      await this.deps.preferred.set(this.deps.network, [...current, denom]);
    }
    return this.preferred();
  }

  async remove(denom: string): Promise<Result<TokenInfo[]>> {
    const current = await this.deps.preferred.get(this.deps.network);
    if (!current.includes(denom)) return this.preferred();
    if (current.length === 1) {
      return fail(TokenErrorCodes.lastToken, 'At least one token must stay in the list.');
    }
    await this.deps.preferred.set(
      this.deps.network,
      current.filter((d) => d !== denom),
    );
    return this.preferred();
  }

  async search(query: string): Promise<Result<TokenInfo[]>> {
    const needle = query.trim().slice(0, MAX_QUERY_LENGTH).toLowerCase();
    const held = new Set<string>([NATIVE_DENOM]);
    for (const { balances } of await this.storedBalances(false)) {
      for (const [denom, amount] of Object.entries(balances))
        if (BigInt(amount) > 0n) held.add(denom);
    }
    const candidates = [...held].slice(0, MAX_SEARCH_CANDIDATES);
    const tokens = await this.resolveAll(candidates);
    return ok(
      tokens.filter(
        (t) =>
          needle === '' ||
          t.symbol.toLowerCase().includes(needle) ||
          t.name.toLowerCase().includes(needle) ||
          t.denom.toLowerCase().includes(needle),
      ),
    );
  }

  async balances(denom: string, refresh: boolean): Promise<Result<TokenBalances>> {
    const addresses = await this.deps.addresses.list(this.deps.network);
    const stored = await this.storedBalances(refresh, addresses);
    let total = 0n;
    const rows = addresses.map((a, i) => {
      const amount = BigInt(stored[i]?.balances[denom] ?? '0');
      total += amount;
      return { index: a.index, address: a.address, amount: amount.toString() };
    });
    return ok({ denom, addresses: rows, total: total.toString() });
  }

  async theme(denom: string): Promise<Result<DenomBranding | null>> {
    if (denom === NATIVE_DENOM) return ok(null);
    const found = await this.lookup(denom);
    return found.ok ? ok(found.value.branding) : found;
  }

  /** Unreadable denoms (e.g. a hostile one held on an address) are left out, never fatal. */
  private async resolveAll(denoms: string[]): Promise<TokenInfo[]> {
    const settled = await Promise.allSettled(denoms.map((d) => this.resolver.resolve(d)));
    return settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  }

  /** One entry per address, in order; reads through the session store with a 10 s freshness. */
  private async storedBalances(
    refresh: boolean,
    addresses?: Awaited<ReturnType<WalletAddresses['list']>>,
  ): Promise<StoredBalances[]> {
    const list = addresses ?? (await this.deps.addresses.list(this.deps.network));
    return Promise.all(
      list.map(async ({ address }) => {
        const key = `balances:${this.deps.network}:${address}`;
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
  }
}

function noSuchToken(): Result<never> {
  return fail(TokenErrorCodes.noSuchToken, 'No token with this code on BeeZee');
}

function invalidCode(): Result<never> {
  return fail(TokenErrorCodes.invalidCode, 'This is not a valid token code.');
}
