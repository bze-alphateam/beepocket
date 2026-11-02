import { ErrorCodes, fail, ok } from '../protocol';
import type { HandlerRegistry } from '../background/registry';
import type { DappService } from './service';

/** The request window's two calls. They live in the popup registry: own pages only. */
export function registerDappPopupHandlers(registry: HandlerRegistry, dapp: DappService): void {
  registry.register('dapp.current', {
    validate: () => ok({}),
    handle: async () => ok(await dapp.current()),
  });
  registry.register('dapp.answer', {
    validate: (payload) => {
      if (typeof payload !== 'object' || payload === null) {
        return fail(ErrorCodes.badRequest, 'dapp.answer got a malformed request.');
      }
      const { id, approve, index } = payload as Record<string, unknown>;
      if (typeof id !== 'string' || typeof approve !== 'boolean') {
        return fail(ErrorCodes.badRequest, 'dapp.answer got a malformed request.');
      }
      if (index !== undefined && (typeof index !== 'number' || !Number.isInteger(index))) {
        return fail(ErrorCodes.badRequest, 'dapp.answer got a malformed request.');
      }
      return ok(index === undefined ? { id, approve } : { id, approve, index });
    },
    handle: (request) =>
      dapp.answer(request.id, {
        approve: request.approve,
        ...(request.index === undefined ? {} : { index: request.index }),
      }),
  });
}
