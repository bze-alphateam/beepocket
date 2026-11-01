import { ok } from '../../protocol';
import type { HandlerRegistry } from '../registry';
import type { HandlerDeps } from './index';

export function registerAppHandlers(registry: HandlerRegistry, deps: HandlerDeps): void {
  registry.register('app.ping', (req) =>
    Promise.resolve(ok({ nonce: req.nonce, at: deps.platform.clock.now() })),
  );
}
