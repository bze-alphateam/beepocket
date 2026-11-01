import { Vault } from '@beepocket/core';
import type { Platform } from '../../platform';
import type { Services } from '../../background/services';
import type { Alarms } from './alarms';
import { WalletService, type WalletDeps } from './service';

export { registerWalletHandlers } from './handlers';
export { ChromeAlarms, type AlarmEventLike, type AlarmsLike, type Alarms } from './alarms';
export { SESSION_KEY, SESSION_PROFILE, WalletService, type WalletDeps } from './service';
export type { Profile, ProfileAddress, ProfileSettings } from './profile';

/** Composition root of the wallet: real core `Vault` over the platform adapters. */
export function createWalletService(
  platform: Platform,
  services: Services,
  alarms: Alarms,
  onStateChange?: WalletDeps['onStateChange'],
): WalletService {
  return new WalletService({
    storage: platform.storage,
    session: platform.session,
    vault: new Vault({ random: platform.random, cipher: platform.cipher, kdf: platform.kdf }),
    random: platform.random,
    clock: platform.clock,
    alarms,
    chain: async () => (await services.clients()).chain,
    ...(onStateChange ? { onStateChange } : {}),
  });
}
