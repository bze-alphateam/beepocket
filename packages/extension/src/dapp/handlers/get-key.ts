import type { DappRegistry } from '../registry';
import { keyHandler, type KeyDeps } from './key';

/** `getKey(chainId)`: the connected address, or `not-connected`; never opens a window by itself. */
export function registerGetKey(registry: DappRegistry, deps: KeyDeps): void {
  registry.register('getKey', keyHandler(deps, 'getKey'));
}
