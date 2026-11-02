import type { NetworkId } from '@beepocket/core';
import type { WireError } from './wire';

/** How a request ends: a JSON result for the page, or an error it sees as `{ code, message }`. */
export type Outcome = { result: unknown } | { error: WireError };

export const answer = (result: unknown): Outcome => ({ result });
export const refuse = (code: string, message: string): Outcome => ({ error: { code, message } });

/** A dapp request waiting for the user, kept in `chrome.storage.session` (`dapp.requests`). */
export interface PendingRequest {
  id: string;
  /** `sender.origin` of the page's top frame: the site. Never read from the payload. */
  origin: string;
  network: NetworkId;
  method: string;
  /** Validated params of the method. */
  params: unknown;
  tabId: number;
  /** The exact document that asked; answers go only there. */
  documentId: string;
  createdAt: number;
}

/** Who is asking, taken from the browser's `sender`, never from the message. */
export interface DappSender {
  origin: string;
  tabId: number;
  documentId: string;
}
