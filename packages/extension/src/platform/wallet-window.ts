/** The inner size of a wallet window (dapp requests, add-a-token links): the popup's frame. */
export const WALLET_WINDOW = { width: 360, height: 600 } as const;

/** Gap between the wallet window and the browser window's right edge. */
const RIGHT_GAP = 16;
/** Drop below the browser's tab strip and toolbar, where the extension icon sits. */
const TOP_OFFSET = 80;

/** What `chrome.windows.create` takes for a wallet window. */
export interface WalletWindowCreate {
  url: string;
  type: 'popup';
  width: number;
  height: number;
  focused: boolean;
  left?: number;
  top?: number;
}

/** The bounds `chrome.windows.getLastFocused` reports; any of them can be missing. */
export interface WindowBounds {
  left?: number | undefined;
  top?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  state?: string | undefined;
}

/** The slice of `chrome.windows` that opens a wallet window. */
export interface WalletWindowsLike<Created> {
  create(info: WalletWindowCreate): Promise<Created>;
  getLastFocused(info: { windowTypes: 'normal'[] }): Promise<WindowBounds>;
}

/**
 * Where a wallet window goes: the top-right corner of the last focused browser window, under
 * the toolbar, like other wallet extensions. Kept inside that window's bounds, which are on
 * screen (the worker cannot read the screen). Nothing when the window is unknown or minimized:
 * the browser then picks the place.
 */
async function placement(
  windows: WalletWindowsLike<unknown>,
): Promise<{ left: number; top: number } | null> {
  let win: WindowBounds;
  try {
    win = await windows.getLastFocused({ windowTypes: ['normal'] });
  } catch {
    return null;
  }
  const { left, top, width, height, state } = win;
  if (left === undefined || top === undefined || width === undefined || height === undefined) {
    return null;
  }
  if (state === 'minimized') return null;
  const x = Math.max(left, left + width - WALLET_WINDOW.width - RIGHT_GAP);
  const y = Math.max(top, Math.min(top + TOP_OFFSET, top + height - WALLET_WINDOW.height));
  return { left: Math.round(x), top: Math.round(y) };
}

/**
 * Opens a focused 360 × 600 wallet window near the extension icon. A browser that refuses the
 * position (bounds off every display) gets a second try without one.
 */
export async function openWalletWindow<Created>(
  windows: WalletWindowsLike<Created>,
  url: string,
): Promise<Created> {
  const info: WalletWindowCreate = { url, type: 'popup', ...WALLET_WINDOW, focused: true };
  const at = await placement(windows);
  if (at === null) return windows.create(info);
  try {
    return await windows.create({ ...info, ...at });
  } catch {
    return windows.create(info);
  }
}
