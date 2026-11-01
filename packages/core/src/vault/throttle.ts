/** Persistable throttle state; keep it in storage so reopening the popup does not reset it. */
export interface ThrottleState {
  /** Consecutive failed attempts. */
  failures: number;
  /** Epoch milliseconds until which attempts are refused (0 = not locked). */
  lockedUntil: number;
}

export const INITIAL_THROTTLE_STATE: ThrottleState = { failures: 0, lockedUntil: 0 };

const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const FAILURES_PER_STEP = 5;

/**
 * Wrong-password throttle: every 5th consecutive failure locks for 30 s, doubling per further
 * 5 failures, capped at 15 min. A success resets. Pure logic: nothing is stored or wiped.
 */
export class PasswordThrottle {
  next(
    state: ThrottleState,
    now: number,
    success: boolean,
  ): { state: ThrottleState; lockedUntil: number | null } {
    if (success) return { state: { ...INITIAL_THROTTLE_STATE }, lockedUntil: null };
    const failures = state.failures + 1;
    let lockedUntil = state.lockedUntil;
    if (failures % FAILURES_PER_STEP === 0) {
      const step = failures / FAILURES_PER_STEP - 1;
      lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** Math.min(step, 16), MAX_LOCK_MS);
    }
    return {
      state: { failures, lockedUntil },
      lockedUntil: lockedUntil > now ? lockedUntil : null,
    };
  }
}
