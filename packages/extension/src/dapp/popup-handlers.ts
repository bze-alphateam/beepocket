import { ErrorCodes, fail, ok, type ReviewedFee } from '../protocol';
import type { HandlerRegistry } from '../background/registry';
import type { DappService } from './service';

const BASE_UNITS = /^\d{1,60}$/;

function reviewedFee(x: unknown): ReviewedFee | null {
  if (typeof x !== 'object' || x === null) return null;
  const { denom, amount, gasLimit } = x as Record<string, unknown>;
  return typeof denom === 'string' &&
    typeof amount === 'string' &&
    typeof gasLimit === 'string' &&
    BASE_UNITS.test(amount) &&
    BASE_UNITS.test(gasLimit)
    ? { denom, amount, gasLimit }
    : null;
}

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
      const { id, approve, index, fee } = payload as Record<string, unknown>;
      if (typeof id !== 'string' || typeof approve !== 'boolean') {
        return fail(ErrorCodes.badRequest, 'dapp.answer got a malformed request.');
      }
      if (index !== undefined && (typeof index !== 'number' || !Number.isInteger(index))) {
        return fail(ErrorCodes.badRequest, 'dapp.answer got a malformed request.');
      }
      const reviewed = fee === undefined ? null : reviewedFee(fee);
      if (fee !== undefined && reviewed === null) {
        return fail(ErrorCodes.badRequest, 'dapp.answer got a malformed request.');
      }
      return ok({
        id,
        approve,
        ...(index === undefined ? {} : { index }),
        ...(reviewed === null ? {} : { fee: reviewed }),
      });
    },
    handle: (request) =>
      dapp.answer(request.id, {
        approve: request.approve,
        ...(request.index === undefined ? {} : { index: request.index }),
        ...(request.fee === undefined ? {} : { fee: request.fee }),
      }),
  });
}
