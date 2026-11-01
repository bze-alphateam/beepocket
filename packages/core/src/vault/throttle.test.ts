import { describe, expect, it } from 'vitest';
import { INITIAL_THROTTLE_STATE, PasswordThrottle, passwordRules } from '../index';

describe('PasswordThrottle', () => {
  const throttle = new PasswordThrottle();

  function fail(times: number, now = 1_000_000) {
    let state = INITIAL_THROTTLE_STATE;
    let out = { state, lockedUntil: null as number | null };
    for (let i = 0; i < times; i++) {
      out = throttle.next(state, now, false);
      state = out.state;
    }
    return out;
  }

  it('does not lock for the first 4 failures', () => {
    expect(fail(4).lockedUntil).toBeNull();
  });

  it('locks 30 s on the 5th, 60 s on the 10th, then doubles', () => {
    expect(fail(5).lockedUntil).toBe(1_000_000 + 30_000);
    expect(fail(10).lockedUntil).toBe(1_000_000 + 60_000);
    expect(fail(15).lockedUntil).toBe(1_000_000 + 120_000);
  });

  it('caps at 15 minutes', () => {
    expect(fail(30).lockedUntil).toBe(1_000_000 + 900_000);
    expect(fail(500).lockedUntil).toBe(1_000_000 + 900_000);
  });

  it('resets on success', () => {
    const locked = fail(5);
    const ok = throttle.next(locked.state, 2_000_000, true);
    expect(ok).toEqual({ state: INITIAL_THROTTLE_STATE, lockedUntil: null });
  });
});

describe('passwordRules', () => {
  it('requires 8 characters', () => {
    expect(passwordRules('short')).toEqual({ ok: false, strength: 0 });
    expect(passwordRules('longenou').ok).toBe(true);
  });

  it('grows strength with length and character classes', () => {
    expect(passwordRules('longenou').strength).toBe(1);
    expect(passwordRules('Longenough1').strength).toBe(2);
    expect(passwordRules('Longenough12').strength).toBe(3);
    expect(passwordRules('Longenough1234567!').strength).toBe(4);
  });
});
