import { FeeEstimator } from '@beepocket/core';
import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import type { SendPrepareRequest, SendSubmitRequest } from '../../protocol/send';
import type { HandlerDeps } from '../../background/handlers';
import type { HandlerRegistry } from '../../background/registry';
import { createTokenResolver } from '../tokens/resolver';
import { SendService } from './service';

type Payload = Record<string, unknown>;

function asObject(payload: unknown): Payload | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Payload)
    : null;
}

const isIndex = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function validatePrepare(payload: unknown): Result<SendPrepareRequest> {
  const p = asObject(payload);
  if (
    !p ||
    !isIndex(p.fromIndex) ||
    typeof p.to !== 'string' ||
    typeof p.denom !== 'string' ||
    typeof p.amount !== 'string' ||
    (p.max !== undefined && typeof p.max !== 'boolean') ||
    (p.feeDenom !== undefined && typeof p.feeDenom !== 'string')
  ) {
    return fail(ErrorCodes.badRequest, 'send.prepare got a malformed request.');
  }
  return ok({
    fromIndex: p.fromIndex,
    to: p.to,
    denom: p.denom,
    amount: p.amount,
    ...(p.max === undefined ? {} : { max: p.max }),
    ...(p.feeDenom === undefined ? {} : { feeDenom: p.feeDenom }),
  });
}

function validateSubmit(payload: unknown): Result<SendSubmitRequest> {
  const p = asObject(payload);
  if (
    !p ||
    !isIndex(p.fromIndex) ||
    typeof p.to !== 'string' ||
    typeof p.denom !== 'string' ||
    typeof p.amount !== 'string' ||
    typeof p.feeDenom !== 'string' ||
    typeof p.feeAmount !== 'string' ||
    typeof p.gasLimit !== 'string'
  ) {
    return fail(ErrorCodes.badRequest, 'send.submit got a malformed request.');
  }
  return ok({
    fromIndex: p.fromIndex,
    to: p.to,
    denom: p.denom,
    amount: p.amount,
    feeDenom: p.feeDenom,
    feeAmount: p.feeAmount,
    gasLimit: p.gasLimit,
  });
}

/** The send service is built per request over the active network's clients; nothing is kept. */
export function registerSendHandlers(
  registry: HandlerRegistry,
  deps: Pick<HandlerDeps, 'platform' | 'services' | 'wallet'>,
): void {
  const { platform, services, wallet } = deps;
  const service = async (): Promise<SendService> => {
    const { network, chain, scan } = await services.clients();
    const tokens = createTokenResolver({ chain, scan, cache: platform.cache }, network.id);
    return new SendService({
      network,
      chain,
      tokens,
      fees: new FeeEstimator(chain, platform.clock, {
        cache: platform.cache,
        cacheKeyPrefix: `${network.id}:`,
        tokens,
      }),
      wallet,
      clock: platform.clock,
    });
  };

  registry.register('send.prepare', {
    validate: validatePrepare,
    handle: async (req) => (await service()).prepare(req),
  });
  registry.register('send.submit', {
    validate: validateSubmit,
    handle: async (req) => (await service()).submit(req),
  });
  registry.register('send.status', {
    validate: (payload) => {
      const p = asObject(payload);
      return p && typeof p.txHash === 'string'
        ? ok({ txHash: p.txHash })
        : fail(ErrorCodes.badRequest, 'send.status needs a string txHash.');
    },
    handle: async (req) => (await service()).status(req.txHash),
  });
}
