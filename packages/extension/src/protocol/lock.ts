import type { WalletState } from './wallet';

/** Message name the worker pushes to open popups when the wallet state changes. */
export const LOCK_STATE_EVENT = 'wallet.stateChanged';

export interface LockStateEvent {
  event: typeof LOCK_STATE_EVENT;
  state: WalletState;
  retryAt: number | null;
}

export function lockStateEvent(state: WalletState, retryAt: number | null): LockStateEvent {
  return { event: LOCK_STATE_EVENT, state, retryAt };
}

const STATES: readonly unknown[] = ['uninitialised', 'locked', 'unlocked', 'weakLocked'];

export function isLockStateEvent(x: unknown): x is LockStateEvent {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    e.event === LOCK_STATE_EVENT &&
    STATES.includes(e.state) &&
    (e.retryAt === null || typeof e.retryAt === 'number')
  );
}
