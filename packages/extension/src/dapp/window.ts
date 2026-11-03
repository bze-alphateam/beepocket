import type { SessionStorage } from '../platform';
import { showInPopup, type ToolbarPopup } from '../platform/toolbar-popup';
import { openWalletWindow, type WalletWindowsLike } from '../platform/wallet-window';
import { WINDOW_KEY } from './requests';

export interface WindowsLike extends WalletWindowsLike<{ id?: number | undefined } | undefined> {
  get(windowId: number): Promise<unknown>;
  update(windowId: number, info: { focused: boolean }): Promise<unknown>;
}

export const REQUEST_URL = 'popup.html?window=request';

/**
 * Where a request is shown: the toolbar popup when the browser can open it, else the one request
 * window, opened when a request needs the user and focused when already open. A popup dismissed
 * by a click elsewhere leaves the queue as it is; closing the window rejects it.
 */
export class RequestWindow {
  constructor(
    private readonly windows: WindowsLike,
    private readonly session: SessionStorage,
    private readonly popup?: ToolbarPopup,
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
        await this.windows.get(id);
        await this.windows.update(id, { focused: true });
        return;
      } catch {
        // closed since: open a new one
      }
    }
    if (await showInPopup(this.popup)) return;
    const created = await openWalletWindow(this.windows, REQUEST_URL);
    if (created?.id !== undefined) await this.session.set(WINDOW_KEY, created.id);
  }

  /** The browser closed a window; says whether it was the request window (and forgets it). */
  async closed(windowId: number): Promise<boolean> {
    if ((await this.session.get(WINDOW_KEY)) !== windowId) return false;
    await this.session.remove(WINDOW_KEY);
    return true;
  }
}
