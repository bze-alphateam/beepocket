import type { Platform } from '../../platform';
import type { HandlerRegistry } from '../registry';
import type { Services } from '../services';
import { registerTokenHandlers } from '../../features/tokens/handlers';
import { interimSeams } from '../../features/tokens/interim';
import { registerAppHandlers } from './app';

/** What handlers may use. Handlers hold no state of their own: the worker can restart. */
export interface HandlerDeps {
  platform: Platform;
  services: Services;
}

/** One line per feature: `register<Feature>Handlers(registry, deps)`. */
export function registerHandlers(registry: HandlerRegistry, deps: HandlerDeps): void {
  registerAppHandlers(registry, deps);
  registerTokenHandlers(registry, deps, interimSeams(deps.platform));
}
