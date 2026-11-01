import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import type { HandlerDeps } from '../../background/handlers';
import type { HandlerRegistry } from '../../background/registry';
import type { PreferredTokensStore, WalletAddresses } from './ports';
import { TokenService } from './service';

export interface TokenSeams {
  preferred: PreferredTokensStore;
  addresses: WalletAddresses;
}

function field(payload: unknown, name: string): unknown {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)[name]
    : undefined;
}

function stringField<K extends string>(method: string, name: K) {
  return (payload: unknown): Result<Record<K, string>> => {
    const value = field(payload, name);
    return typeof value === 'string'
      ? ok({ [name]: value } as Record<K, string>)
      : fail(ErrorCodes.badRequest, `${method} needs a string ${name}.`);
  };
}

/** The seams are passed in by the composition root: the wallet-backed ones (see wallet-seams.ts). */
export function registerTokenHandlers(
  registry: HandlerRegistry,
  deps: HandlerDeps,
  seams: TokenSeams,
): void {
  const { platform, services } = deps;
  const service = async (): Promise<TokenService> => {
    const { network, chain, scan } = await services.clients();
    return new TokenService({
      network: network.id,
      chain,
      scan,
      cache: platform.cache,
      session: platform.session,
      clock: platform.clock,
      ...seams,
    });
  };

  const noArgs = (): Result<Record<string, never>> => ok({});

  registry.register('tokens.lookup', {
    validate: stringField('tokens.lookup', 'code'),
    handle: async (req) => (await service()).lookup(req.code),
  });
  registry.register('tokens.preferred', {
    validate: noArgs,
    handle: async () => (await service()).preferred(),
  });
  registry.register('tokens.add', {
    validate: stringField('tokens.add', 'denom'),
    handle: async (req) => (await service()).add(req.denom),
  });
  registry.register('tokens.remove', {
    validate: stringField('tokens.remove', 'denom'),
    handle: async (req) => (await service()).remove(req.denom),
  });
  registry.register('tokens.search', {
    validate: stringField('tokens.search', 'query'),
    handle: async (req) => (await service()).search(req.query),
  });
  registry.register('tokens.balances', {
    validate: (p) => {
      const denom = stringField('tokens.balances', 'denom')(p);
      if (!denom.ok) return denom;
      const refresh = field(p, 'refresh');
      if (refresh !== undefined && typeof refresh !== 'boolean') {
        return fail(ErrorCodes.badRequest, 'tokens.balances refresh must be a boolean.');
      }
      return ok(refresh === undefined ? denom.value : { ...denom.value, refresh });
    },
    handle: async (req) => (await service()).balances(req.denom, req.refresh === true),
  });
  registry.register('tokens.theme', {
    validate: stringField('tokens.theme', 'denom'),
    handle: async (req) => (await service()).theme(req.denom),
  });
}
