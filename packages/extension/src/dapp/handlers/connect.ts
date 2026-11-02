import type { DappRegistry } from '../registry';
import { keyHandler, type KeyDeps } from './key';

/** `connect(chainId)`: answers at once for a connected site, otherwise asks the user. */
export function registerConnect(registry: DappRegistry, deps: KeyDeps): void {
  registry.register('connect', keyHandler(deps, 'connect'));
}
