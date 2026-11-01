/** One-shot named timers that survive a stopped service worker (`chrome.alarms`). */
export interface Alarms {
  /** Starts the named timer, replacing a running one of the same name. */
  set(name: string, delayMinutes: number): Promise<void>;
  clear(name: string): Promise<void>;
}

/** The slice of `chrome.alarms` the adapter uses. */
export interface AlarmsLike {
  create(name: string, info: { delayInMinutes: number }): Promise<void>;
  clear(name: string): Promise<boolean>;
}

export interface AlarmEventLike {
  addListener(listener: (alarm: { name: string }) => void): void;
}

export class ChromeAlarms implements Alarms {
  constructor(private readonly area: AlarmsLike) {}

  set(name: string, delayMinutes: number): Promise<void> {
    return this.area.create(name, { delayInMinutes: delayMinutes });
  }

  async clear(name: string): Promise<void> {
    await this.area.clear(name);
  }
}

export const WEAK_LOCK_ALARM = 'weak-lock';
export const FULL_LOCK_ALARM = 'full-lock';
