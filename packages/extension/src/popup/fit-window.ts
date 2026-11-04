import { WALLET_WINDOW } from '../platform/wallet-window';

/** The page's view of its window: `window` itself in the browser. */
export interface WindowView {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
}

/** The slice of `chrome.windows` a wallet window resizes itself with. */
export interface CurrentWindowLike {
  getCurrent(): Promise<{ id?: number | undefined }>;
  update(windowId: number, info: { width: number; height: number }): Promise<unknown>;
}

/**
 * `windows.create` sizes the outer window, so the title bar and borders eat into the 360 × 600
 * the wallet asked for (about 28 px on macOS, more elsewhere). Grows the window by exactly that
 * frame so the page gets the full area. Only for wallet windows: in the toolbar popup the
 * current window is the user's browser window.
 */
export async function fitWalletWindow(view: WindowView, windows: CurrentWindowLike): Promise<void> {
  const { innerWidth, innerHeight, outerWidth, outerHeight } = view;
  // Not laid out yet: nothing to measure against.
  if (innerWidth <= 0 || innerHeight <= 0) return;
  if (innerWidth === WALLET_WINDOW.width && innerHeight === WALLET_WINDOW.height) return;
  const current = await windows.getCurrent();
  if (current.id === undefined) return;
  await windows.update(current.id, {
    width: WALLET_WINDOW.width + Math.max(0, outerWidth - innerWidth),
    height: WALLET_WINDOW.height + Math.max(0, outerHeight - innerHeight),
  });
}
