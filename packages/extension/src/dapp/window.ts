import type { SessionStorage } from '../platform';
import { showInPopup, type ToolbarPopup } from '../platform/toolbar-popup';
import { openWalletWindow, type WalletWindowsLike } from '../platform/wallet-window';
import { WINDOW_KEY } from './requests';

export interface WindowsLike extends WalletWindowsLike<{ id?: number | undefined } | undefined> {
  get(windowId: number): Promise<unknown>;
  update(windowId: number, info: { focused: boolean }): Promise<unknown>;
}

export const REQUEST_URL = 'popup.html?window=request';

/** How long one browser call may take before the window gives up on it and moves on. */
export const BROWSER_CALL_DEADLINE_MS = 5_000;

/** The time source of the deadline (`Clock.sleep`). */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

/**
 * Where a request is shown: the toolbar popup when the browser can open it, else the one request
 * window, opened when a request needs the user and focused when already open. A popup dismissed
 * by a click elsewhere leaves the queue as it is; closing the window rejects it.
 *
 * With a `timer`, no browser call can hold the window up: one that does not settle in
 * `BROWSER_CALL_DEADLINE_MS` counts as failed (a popup that never opens falls through to the
 * window), so a hung call cannot block every later `show()` queued behind it.
 */
export class RequestWindow {
  constructor(
    private readonly windows: WindowsLike,
    private readonly session: SessionStorage,
    private readonly popup?: ToolbarPopup,
    private readonly timer?: Sleeper,
  ) {}

  private tail: Promise<unknown> = Promise.resolve();

  /** Calls run one after another, so requests arriving together open one window, not two. */
  show(): Promise<void> {
    const run = this.tail.then(
      () => this.open(),
      () => this.open(),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async open(): Promise<void> {
    const id = await this.session.get(WINDOW_KEY);
    if (typeof id === 'number') {
      try {
        await this.within(this.windows.get(id));
        await this.within(this.windows.update(id, { focused: true }));
        return;
      } catch {
        // closed since: open a new one
      }
    }
    if (await this.within(showInPopup(this.popup)).catch(() => false)) return;
    const created = await this.within(openWalletWindow(this.windows, REQUEST_URL));
    if (created?.id !== undefined) await this.session.set(WINDOW_KEY, created.id);
  }

  /** `call`, or a rejection once the deadline passes first. */
  private async within<T>(call: Promise<T>): Promise<T> {
    const timer = this.timer;
    if (timer === undefined) return call;
    const late = Symbol('late');
    const first = await Promise.race([
      call,
      timer.sleep(BROWSER_CALL_DEADLINE_MS).then(() => late),
    ]);
    if (first === late) throw new Error('The browser did not answer in time.');
    return first as T;
  }

  /** The browser closed a window; says whether it was the request window (and forgets it). */
  async closed(windowId: number): Promise<boolean> {
    if ((await this.session.get(WINDOW_KEY)) !== windowId) return false;
    await this.session.remove(WINDOW_KEY);
    return true;
  }
}
