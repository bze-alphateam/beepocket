import type { Platform } from '../../platform';
import type { HandlerRegistry } from '../registry';
import type { Services } from '../services';
import { registerTokenHandlers } from '../../features/tokens/handlers';
import { walletTokenSeams } from '../../features/tokens/wallet-seams';
import type { WalletService } from '../../features/wallet';
import { registerWalletHandlers } from '../../features/wallet/handlers';
import { registerHomeHandlers } from '../../features/home/handlers';
import { registerAppHandlers } from './app';

/** What handlers may use. Handlers hold no state of their own: the worker can restart. */
export interface HandlerDeps {
  platform: Platform;
  services: Services;
  wallet: WalletService;
}

/** One line per feature: `register<Feature>Handlers(registry, deps)`. */
export function registerHandlers(registry: HandlerRegistry, deps: HandlerDeps): void {
  registerAppHandlers(registry, deps);
  registerWalletHandlers(registry, deps.wallet);
  registerTokenHandlers(registry, deps, walletTokenSeams(deps.wallet));
  registerHomeHandlers(registry, deps);
}
