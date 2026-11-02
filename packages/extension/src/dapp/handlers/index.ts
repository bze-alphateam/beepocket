import type { DappRegistry } from '../registry';
import { registerConnect } from './connect';
import { registerGetKey } from './get-key';
import type { TxDeps } from './env';
import { registerSendTx } from './send-tx';
import { registerSignDirect } from './sign-direct';

/** What dapp handlers may use. They hold no state: the worker can restart between calls. */
export type DappHandlerDeps = TxDeps;

/** One line per dapp method: `register<Method>(registry, deps)`. */
export function registerDappHandlers(registry: DappRegistry, deps: DappHandlerDeps): void {
  registerConnect(registry, deps);
  registerGetKey(registry, deps);
  registerSignDirect(registry, deps);
  registerSendTx(registry, deps);
}
