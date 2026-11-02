import type { DappSender } from './types';

/** The parts of `chrome.runtime.MessageSender` the gate looks at. */
export interface SenderLike {
  id?: string | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  frameId?: number | undefined;
  documentId?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
}

/**
 * Accepts only a content script of this extension running in the top frame of a tab on an
 * `https:` page or on `http://localhost`. Anything else (an own page, a subframe, `file:`,
 * `chrome:`, plain `http:`) is not a dapp. Returns the site as the browser reports it.
 */
export function dappSender(sender: SenderLike, extensionId: string | undefined): DappSender | null {
  if (extensionId === undefined || sender.id !== extensionId) return null;
  if (
    typeof sender.url !== 'string' ||
    sender.url.startsWith(`chrome-extension://${extensionId}/`)
  ) {
    return null;
  }
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number' || sender.frameId !== 0) return null;
  if (typeof sender.documentId !== 'string' || sender.documentId === '') return null;
  const origin = sender.origin;
  if (typeof origin !== 'string' || !allowedOrigin(origin)) return null;
  return { origin, tabId, documentId: sender.documentId };
}

function allowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
}
