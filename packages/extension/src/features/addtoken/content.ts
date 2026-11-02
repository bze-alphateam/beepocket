import { validCode } from './link';

export const OPENED_EVENT = 'beepocket#add-token-opened';

export interface AddTokenPage {
  readonly location: { readonly search: string };
  readonly document: { readonly referrer: string };
  dispatchEvent(event: Event): boolean;
}

export interface AddTokenRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

/**
 * The content script of the add-a-token page (isolated world). It forwards the code and the
 * referrer's origin and, once the wallet took the link, tells the page with one plain event.
 * The worker re-checks everything; the page learns nothing else.
 */
export async function startAddToken(win: AddTokenPage, runtime: AddTokenRuntime): Promise<void> {
  const code = validCode(new URLSearchParams(win.location.search).get('code'));
  if (code === null) return;
  const ack = await runtime
    .sendMessage({ addToken: { code, referrer: referrerOrigin(win) } })
    .catch(() => undefined);
  if (typeof ack === 'object' && ack !== null && 'accepted' in ack) {
    win.dispatchEvent(new Event(OPENED_EVENT));
  }
}

function referrerOrigin(win: AddTokenPage): string {
  if (win.document.referrer === '') return '';
  try {
    return new URL(win.document.referrer).origin;
  } catch {
    return '';
  }
}
