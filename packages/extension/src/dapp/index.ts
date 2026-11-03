import { FeeEstimator } from '@beepocket/core';
import type { Platform } from '../platform';
import type { Alarms } from '../features/wallet/alarms';
import type { Services } from '../background/services';
import { createTokenResolver } from '../features/tokens/resolver';
import type { WalletService } from '../features/wallet';
import { AccountChanges } from './account-changes';
import { DocumentLog } from './documents';
import { SitesService } from './sites';
import { Deliverer, type TabsLike } from './deliver';
import { registerDappHandlers } from './handlers';
import type { ChainEnv } from './handlers/env';
import { DappRegistry } from './registry';
import { RequestStore } from './requests';
import { DappService } from './service';
import { RequestWindow, type WindowsLike } from './window';

export { dappSender, type SenderLike } from './sender';
export { DappService, type Ack } from './service';
export { registerDappPopupHandlers } from './popup-handlers';
export { registerSitesHandlers } from './sites-handlers';
export type { TabsLike, WindowsLike };

/** Composition root of the dapp channel: real stores and chrome adapters over the platform. */
export function createDappService(
  platform: Platform,
  services: Services,
  wallet: WalletService,
  chrome: { tabs: TabsLike; windows: WindowsLike; alarms: Alarms },
): DappService {
  const registry = new DappRegistry();
  // Built per request over the active network's clients, like the send flow's service.
  const env = async (): Promise<ChainEnv> => {
    const { network, chain, scan } = await services.clients();
    const tokens = createTokenResolver({ chain, scan, cache: platform.cache }, network.id);
    const fees = new FeeEstimator(chain, platform.clock, {
      cache: platform.cache,
      cacheKeyPrefix: `${network.id}:`,
      tokens,
    });
    return { network, chain, fees, tokens };
  };
  registerDappHandlers(registry, { wallet, services, clock: platform.clock, env });
  const deliverer = new Deliverer(chrome.tabs);
  const documents = new DocumentLog(platform.session);
  const changes = new AccountChanges({ documents, deliverer });
  return new DappService({
    registry,
    requests: new RequestStore(platform.session, chrome.alarms, platform.clock),
    window: new RequestWindow(chrome.windows, platform.session),
    deliverer,
    documents,
    changes,
    sites: new SitesService({ wallet, services, changes }),
    services,
    clock: platform.clock,
  });
}
