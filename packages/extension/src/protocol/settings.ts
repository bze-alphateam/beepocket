import type { NetworkId } from '@beepocket/core';
import type { Appearance } from '../theme/appearance';

/** What the Settings screen edits. Lock timers are whole minutes, the full lock not before the weak lock. */
export interface WalletSettings {
  brandThemes: boolean;
  weakLockMinutes: number;
  fullLockMinutes: number;
}

/** Settings and network methods. Errors: `invalid_settings`, `needs-password`, `wallet_locked`. */
export interface SettingsProtocol {
  /** Works while unlocked or weak locked. */
  'settings.get': { req: Record<string, never>; res: WalletSettings };
  /** Merges the given fields and re-arms the lock timers; needs the wallet unlocked. */
  'settings.set': { req: Partial<WalletSettings>; res: WalletSettings };
  'network.get': { req: Record<string, never>; res: { id: NetworkId } };
  'network.set': { req: { id: NetworkId }; res: { id: NetworkId } };
  /** Dark, light or system. Kept outside the encrypted profile: Welcome and Unlock need it. */
  'appearance.get': { req: Record<string, never>; res: { appearance: Appearance } };
  'appearance.set': { req: { appearance: Appearance }; res: { appearance: Appearance } };
}
