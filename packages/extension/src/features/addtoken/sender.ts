import type { SenderLike } from '../../dapp';
import { LINK_ORIGIN, LINK_PATH } from './link';

export interface LinkSender {
  documentId: string;
}

/**
 * Accepts only this extension's content script in the top frame of getbze.com's add page.
 * Anything else (another site, a subframe, another path, an own page) is not the add-a-token link.
 */
export function linkSender(sender: SenderLike, extensionId: string | undefined): LinkSender | null {
  if (extensionId === undefined || sender.id !== extensionId) return null;
  if (sender.origin !== LINK_ORIGIN || sender.frameId !== 0) return null;
  if (typeof sender.url !== 'string' || typeof sender.documentId !== 'string') return null;
  if (sender.documentId === '') return null;
  try {
    const url = new URL(sender.url);
    if (url.origin !== LINK_ORIGIN || !url.pathname.startsWith(LINK_PATH)) return null;
  } catch {
    return null;
  }
  return { documentId: sender.documentId };
}
