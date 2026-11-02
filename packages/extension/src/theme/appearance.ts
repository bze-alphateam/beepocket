import type { Scheme } from './kits';

/** The appearance setting: an explicit scheme, or `system` to follow the OS. */
export type Appearance = 'dark' | 'light' | 'system';

/** The canvas default. */
export const DEFAULT_APPEARANCE: Appearance = 'dark';

export function isAppearance(x: unknown): x is Appearance {
  return x === 'dark' || x === 'light' || x === 'system';
}

/** The scheme an appearance shows when the OS does (or does not) prefer dark. */
export function resolveScheme(appearance: Appearance, systemDark: boolean): Scheme {
  if (appearance === 'system') return systemDark ? 'dark' : 'light';
  return appearance;
}

/** The OS colour-scheme query: `matchMedia('(prefers-color-scheme: dark)')`. */
export interface SchemeQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

/** A scheme that can change while the popup is open. */
export interface SchemeSource {
  current(): Scheme;
  /** Calls `listener` after every scheme change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * The popup's appearance: the setting plus the OS query, resolved to one scheme. Listeners run
 * in subscription order whenever the shown scheme changes, so the root theme (subscribed first)
 * is applied before a screen re-applies its token kit.
 */
export class AppearanceState implements SchemeSource {
  private value: Appearance;
  private readonly listeners = new Set<() => void>();

  /** `save` persists a choice made in the popup; its failures are ignored. */
  constructor(
    private readonly query: SchemeQuery,
    private readonly save: (appearance: Appearance) => Promise<unknown> = () => Promise.resolve(),
    initial: Appearance = DEFAULT_APPEARANCE,
  ) {
    this.value = initial;
    query.addEventListener('change', () => {
      if (this.value === 'system') this.notify();
    });
  }

  get appearance(): Appearance {
    return this.value;
  }

  current(): Scheme {
    return resolveScheme(this.value, this.query.matches);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Takes the stored setting without saving it again. */
  load(appearance: Appearance): void {
    this.change(appearance);
  }

  /** The user's choice: shown at once, then saved. */
  set(appearance: Appearance): void {
    this.change(appearance);
    void this.save(appearance).catch(() => undefined);
  }

  /** The header button: from whatever shows now to the explicit other scheme. */
  toggle(): void {
    this.set(this.current() === 'dark' ? 'light' : 'dark');
  }

  private change(appearance: Appearance): void {
    const before = this.current();
    this.value = appearance;
    if (this.current() !== before) this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
