import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import type { HandlerDeps } from '../../background/handlers';
import type { HandlerRegistry } from '../../background/registry';
import { ActivityService } from './service';

interface Req {
  denom: string;
  addressIndex?: number;
  cursor?: string;
}

function validate(payload: unknown): Result<Req> {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  if (typeof p.denom !== 'string' || p.denom === '') {
    return fail(ErrorCodes.badRequest, 'activity.page needs a denom.');
  }
  const req: Req = { denom: p.denom };
  if (p.addressIndex !== undefined) {
    if (!Number.isInteger(p.addressIndex)) {
      return fail(ErrorCodes.badRequest, 'activity.page needs an integer addressIndex.');
    }
    req.addressIndex = p.addressIndex as number;
  }
  if (p.cursor !== undefined) {
    if (typeof p.cursor !== 'string') {
      return fail(ErrorCodes.badRequest, 'activity.page needs a string cursor.');
    }
    req.cursor = p.cursor;
  }
  return ok(req);
}

/** `activity.page`; the service is rebuilt per call, so the worker keeps no state. */
export function registerActivityHandlers(
  registry: HandlerRegistry,
  deps: Pick<HandlerDeps, 'platform' | 'services' | 'wallet'>,
): void {
  registry.register('activity.page', {
    validate,
    handle: async (req) => {
      const { network, scan } = await deps.services.clients();
      const service = new ActivityService({
        scan,
        explorer: network.scan,
        clock: deps.platform.clock,
        addresses: {
          list: async () => {
            const res = await deps.wallet.addresses();
            return res.ok ? ok(res.value.addresses) : res;
          },
        },
      });
      return service.page(req);
    },
  });
}
