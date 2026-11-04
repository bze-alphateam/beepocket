import { ErrorCodes, fail, ok } from '../protocol';
import type { HandlerRegistry } from '../background/registry';
import type { DappService } from './service';

const bad = (method: string) => fail(ErrorCodes.badRequest, `${method} got a malformed request.`);

function fields(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** The Connected sites screen's calls. They live in the popup registry: own pages only. */
export function registerSitesHandlers(registry: HandlerRegistry, dapp: DappService): void {
  const sites = dapp.sites;
  registry.register('sites.list', { validate: () => ok({}), handle: () => sites.list() });
  registry.register('sites.current', { validate: () => ok({}), handle: () => sites.current() });
  registry.register('sites.change', {
    validate: (payload) => {
      const p = fields(payload);
      return p && typeof p.origin === 'string' && Number.isInteger(p.index)
        ? ok({ origin: p.origin, index: p.index as number })
        : bad('sites.change');
    },
    handle: (r) => sites.change(r.origin, r.index),
  });
  registry.register('sites.disconnect', {
    validate: (payload) => {
      const p = fields(payload);
      return p && typeof p.origin === 'string' ? ok({ origin: p.origin }) : bad('sites.disconnect');
    },
    handle: (r) => sites.disconnect(r.origin),
  });
}
