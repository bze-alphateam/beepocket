import type { Platform } from '../platform';
import type { Services } from '../background/services';
import type { WalletService } from '../features/wallet';
import { Deliverer, type TabsLike } from './deliver';
import { registerDappHandlers } from './handlers';
import { DappRegistry } from './registry';
import { RequestStore } from './requests';
import { DappService } from './service';
import { RequestWindow, type WindowsLike } from './window';

export { dappSender, type SenderLike } from './sender';
export { DappService, type Ack } from './service';
export { registerDappPopupHandlers } from './popup-handlers';
export type { TabsLike, WindowsLike };

/** Composition root of the dapp channel: real stores and chrome adapters over the platform. */
export function createDappService(
  platform: Platform,
  services: Services,
  wallet: WalletService,
  chrome: { tabs: TabsLike; windows: WindowsLike },
): DappService {
  const registry = new DappRegistry();
  registerDappHandlers(registry, { wallet, services, clock: platform.clock });
  return new DappService({
    registry,
    requests: new RequestStore(platform.session),
    window: new RequestWindow(chrome.windows, platform.session),
    deliverer: new Deliverer(chrome.tabs),
    services,
    clock: platform.clock,
  });
}
