/** The toolbar popup: the wallet's first choice for showing a request, anchored to its icon. */
export interface ToolbarPopup {
  /** Says whether the popup is showing now. */
  isOpen(): Promise<boolean>;
  /** Opens it; rejects when the browser cannot (no focused window, no API). */
  open(): Promise<void>;
}

/** The slice of `chrome.action`; `openPopup` is missing before Chrome 127. */
export interface ActionLike {
  openPopup?: (() => Promise<void>) | undefined;
}

/** The slice of `chrome.runtime`; `getContexts` is missing before Chrome 116. */
export interface ContextsLike {
  getContexts?: ((filter: { contextTypes: 'POPUP'[] }) => Promise<unknown[]>) | undefined;
}

/** `ToolbarPopup` over `chrome.action` and `chrome.runtime`, read at call time. */
export class ChromeToolbarPopup implements ToolbarPopup {
  constructor(
    private readonly action: ActionLike | undefined,
    private readonly runtime: ContextsLike,
  ) {}

  async isOpen(): Promise<boolean> {
    if (this.runtime.getContexts === undefined) return false;
    try {
      return (await this.runtime.getContexts({ contextTypes: ['POPUP'] })).length > 0;
    } catch {
      return false;
    }
  }

  async open(): Promise<void> {
    const action = this.action;
    if (action?.openPopup === undefined) throw new Error('The toolbar popup cannot be opened.');
    await action.openPopup();
  }
}

/**
 * Shows what waits in the toolbar popup: nothing to do when it is already open (it shows the
 * queue head), else opens it. False when the browser cannot, so the caller opens a window.
 */
export async function showInPopup(popup: ToolbarPopup | undefined): Promise<boolean> {
  if (popup === undefined) return false;
  if (await popup.isOpen()) return true;
  try {
    await popup.open();
    return true;
  } catch {
    return false;
  }
}
