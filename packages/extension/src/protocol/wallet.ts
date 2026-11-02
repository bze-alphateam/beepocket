/** Where the wallet is in its lock cycle. */
export type WalletState = 'uninitialised' | 'locked' | 'unlocked' | 'weakLocked';

export interface WalletAddress {
  index: number;
  label: string;
  address: string;
}

/**
 * What a password check answers. A wrong or throttled password is an expected outcome with
 * data (`retryAt`, epoch ms, for the countdown), so it travels as a value, not as an error.
 */
export type PasswordOutcome<T extends object = object> =
  | ({ status: 'ok' } & T)
  | { status: 'wrong-password'; retryAt: number | null }
  | { status: 'throttled'; retryAt: number };

/** Error codes of the `wallet.*` methods (`ProtocolError.code`). */
export const WalletErrorCodes = {
  uninitialised: 'wallet_uninitialised',
  alreadyInitialised: 'wallet_already_initialised',
  locked: 'wallet_locked',
  needsPassword: 'needs-password',
  passwordTooShort: 'password_too_short',
  invalidMnemonic: 'invalid_mnemonic',
  invalidLabel: 'invalid_label',
  unknownAddress: 'unknown_address',
  /** `wallet.deriveNext` was asked for an index that is no longer the next one. */
  staleIndex: 'stale_index',
  invalidSettings: 'invalid_settings',
  vaultInvalid: 'vault_invalid',
  profileInvalid: 'profile_invalid',
} as const;

export interface WalletProtocol {
  'wallet.state': {
    req: Record<string, never>;
    res: { state: WalletState; retryAt: number | null };
  };
  /** A fresh 24-word phrase for the one-time display; nothing is stored. */
  'wallet.generateMnemonic': { req: Record<string, never>; res: { mnemonic: string } };
  'wallet.createWallet': {
    req: { password: string; mnemonic: string };
    res: { addresses: WalletAddress[] };
  };
  /** Replaces an existing vault (the "forgot password" path) and resets the throttle. */
  'wallet.importWallet': {
    req: { password: string; mnemonic: string };
    res: { addresses: WalletAddress[] };
  };
  'wallet.unlock': { req: { password: string }; res: PasswordOutcome };
  /** Full lock. */
  'wallet.lock': { req: Record<string, never>; res: Record<string, never> };
  /** Weak lock → unlocked. */
  'wallet.reauth': { req: { password: string }; res: PasswordOutcome };
  /** Always asks the password, even when unlocked. */
  'wallet.revealMnemonic': {
    req: { password: string };
    res: PasswordOutcome<{ mnemonic: string }>;
  };
  'wallet.addresses': { req: Record<string, never>; res: { addresses: WalletAddress[] } };
  /** The address `wallet.deriveNext` would add, without storing it. Needs the unlocked wallet. */
  'wallet.previewNext': { req: Record<string, never>; res: { index: number; address: string } };
  /**
   * Stores the next address. `index` pins it to a preview (refused with `stale_index` when it is
   * no longer the next one); `label` names it in the same write.
   */
  'wallet.deriveNext': {
    req: { index?: number; label?: string };
    res: { address: WalletAddress };
  };
  'wallet.renameAddress': {
    req: { index: number; label: string };
    res: { address: WalletAddress };
  };
  /** User interaction: restarts both lock timers. */
  'wallet.touch': { req: Record<string, never>; res: Record<string, never> };
}
