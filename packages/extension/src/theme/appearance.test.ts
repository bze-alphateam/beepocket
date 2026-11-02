import { describe, expect, it, vi } from 'vitest';
import {
  AppearanceState,
  DEFAULT_APPEARANCE,
  isAppearance,
  LocalAppearanceCache,
  resolveScheme,
  themeVars,
  type SchemeQuery,
  type SyncStore,
} from '.';

class FakeQuery implements SchemeQuery {
  private readonly listeners: (() => void)[] = [];
  constructor(public matches: boolean) {}
  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.push(listener);
  }
  flip(matches: boolean): void {
    this.matches = matches;
    for (const l of this.listeners) l();
  }
}

describe('appearance', () => {
  it('defaults to dark, like the canvas', () => {
    expect(DEFAULT_APPEARANCE).toBe('dark');
    // Even when the OS prefers light.
    expect(new AppearanceState(new FakeQuery(false)).current()).toBe('dark');
  });

  it('accepts only the three settings', () => {
    for (const ok of ['dark', 'light', 'system']) expect(isAppearance(ok)).toBe(true);
    for (const bad of ['Dark', '', null, 1, 'auto']) expect(isAppearance(bad)).toBe(false);
  });

  it('resolves system from the OS and explicit choices as they are', () => {
    expect(resolveScheme('system', true)).toBe('dark');
    expect(resolveScheme('system', false)).toBe('light');
    expect(resolveScheme('light', true)).toBe('light');
    expect(resolveScheme('dark', false)).toBe('dark');
  });

  it('follows the OS live only while set to system', () => {
    const query = new FakeQuery(true);
    const state = new AppearanceState(query, { initial: 'system' });
    const seen: string[] = [];
    state.subscribe(() => seen.push(state.current()));
    query.flip(false);
    expect(seen).toEqual(['light']);
    state.load('dark');
    expect(seen).toEqual(['light', 'dark']);
    query.flip(true);
    query.flip(false);
    expect(seen).toEqual(['light', 'dark']);
  });

  it('toggles between explicit dark and light and saves each choice', () => {
    const save = vi.fn(() => Promise.resolve());
    const state = new AppearanceState(new FakeQuery(false), { save, initial: 'system' });
    expect(state.current()).toBe('light');
    state.toggle();
    expect(state.appearance).toBe('dark');
    state.toggle();
    expect(state.appearance).toBe('light');
    expect(save.mock.calls).toEqual([['dark'], ['light']]);
  });

  it('does not save a loaded setting and ignores save failures', async () => {
    const save = vi.fn(() => Promise.reject(new Error('worker gone')));
    const state = new AppearanceState(new FakeQuery(true), { save });
    state.load('light');
    expect(save).not.toHaveBeenCalled();
    state.set('dark');
    await Promise.resolve();
    expect(state.current()).toBe('dark');
  });

  it('notifies only when the shown scheme changes, in subscription order', () => {
    const state = new AppearanceState(new FakeQuery(true));
    const order: string[] = [];
    const stop = state.subscribe(() => order.push('root'));
    state.subscribe(() => order.push('screen'));
    state.set('system'); // still dark
    expect(order).toEqual([]);
    state.set('light');
    expect(order).toEqual(['root', 'screen']);
    stop();
    state.set('dark');
    expect(order).toEqual(['root', 'screen', 'screen']);
  });
});

class MemoryStore implements SyncStore {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

describe('first paint from the cached appearance', () => {
  it('starts from the cached value, then the stored value wins and is cached', () => {
    const store = new MemoryStore();
    store.setItem('beepocket.appearance', 'light');
    const cache = new LocalAppearanceCache(() => store);
    const state = new AppearanceState(new FakeQuery(true), { cache });
    // Before the worker answers: light at once, not the dark default.
    expect(state.current()).toBe('light');
    const seen: string[] = [];
    state.subscribe(() => seen.push(state.current()));
    state.load('dark');
    expect(seen).toEqual(['dark']);
    expect(store.getItem('beepocket.appearance')).toBe('dark');
    // The next page opens dark straight away.
    expect(new AppearanceState(new FakeQuery(false), { cache }).current()).toBe('dark');
  });

  it('caches a choice made in the popup', () => {
    const store = new MemoryStore();
    const state = new AppearanceState(new FakeQuery(true), {
      cache: new LocalAppearanceCache(() => store),
    });
    state.set('system');
    expect(store.getItem('beepocket.appearance')).toBe('system');
  });

  it('falls back to dark when the cache is empty, garbage or broken', () => {
    const empty = new LocalAppearanceCache(() => new MemoryStore());
    expect(new AppearanceState(new FakeQuery(false), { cache: empty }).current()).toBe('dark');
    const garbage = new MemoryStore();
    garbage.setItem('beepocket.appearance', 'sepia');
    expect(new LocalAppearanceCache(() => garbage).read()).toBeNull();
    const broken = new LocalAppearanceCache(() => {
      throw new Error('storage blocked');
    });
    expect(broken.read()).toBeNull();
    expect(() => {
      broken.write('light');
    }).not.toThrow();
    const state = new AppearanceState(new FakeQuery(false), { cache: broken });
    expect(state.current()).toBe('dark');
    state.set('light');
    expect(state.current()).toBe('light');
  });
});

describe('onboarding board variables', () => {
  // Values the Onboarding board hard-codes for the default kit.
  it('mixes the default kit into the board values', () => {
    const dark = themeVars({ denom: null, branding: null, brandThemes: true, scheme: 'dark' });
    expect(dark['--bp-mark-shadow']).toBe('0 14px 26px rgba(61,208,122,0.32)');
    expect(dark['--bp-pick-line']).toBe('rgba(61,208,122,0.6)');
    expect(dark['--bp-veil']).toBe('rgba(10,12,16,0.35)');
    expect(dark).not.toHaveProperty('--bp-track');
    const light = themeVars({ denom: null, branding: null, brandThemes: true, scheme: 'light' });
    expect(light['--bp-mark-shadow']).toBe('0 14px 22px rgba(26,122,67,0.22)');
    expect(light['--bp-switch-off']).toBe('#D5DAE1');
    expect(light['--bp-seg-on']).toBe('#FFFFFF');
    expect(light['--bp-secondary-fill']).toBe('#FFFFFF');
    expect(light['--bp-veil']).toBe('rgba(245,247,250,0.35)');
  });
});
