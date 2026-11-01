import { fail, ok, ErrorCodes } from '../../protocol';
import type { HandlerRegistry } from '../registry';
import type { HandlerDeps } from './index';

export function registerAppHandlers(registry: HandlerRegistry, deps: HandlerDeps): void {
  registry.register('app.ping', {
    validate: (payload) =>
      typeof payload === 'object' &&
      payload !== null &&
      'nonce' in payload &&
      typeof payload.nonce === 'string'
        ? ok({ nonce: payload.nonce })
        : fail(ErrorCodes.badRequest, 'app.ping needs a string nonce.'),
    handle: (req) => Promise.resolve(ok({ nonce: req.nonce, at: deps.platform.clock.now() })),
  });
}
