import type { DappRegistry } from '../registry';
import { registerConnect } from './connect';
import { registerGetKey } from './get-key';
import type { KeyDeps } from './key';

/** What dapp handlers may use. They hold no state: the worker can restart between calls. */
export type DappHandlerDeps = KeyDeps;

/** One line per dapp method: `register<Method>(registry, deps)`. */
export function registerDappHandlers(registry: DappRegistry, deps: DappHandlerDeps): void {
  registerConnect(registry, deps);
  registerGetKey(registry, deps);
}
