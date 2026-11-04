/**
 * What crosses the page ↔ worker boundary. The content-script relay and the worker speak JSON
 * only: bytes travel as base64 strings and bigints as decimal strings. The in-page provider
 * does the converting, so pages see real `Uint8Array` / `bigint`.
 */

/** Error codes a dapp can see (Technical Design §8). */
export const DappErrorCodes = {
  rejected: 'rejected',
  lockedTimeout: 'locked-timeout',
  notConnected: 'not-connected',
  wrongChain: 'wrong-chain',
  invalidRequest: 'invalid-request',
  expired: 'expired',
  /** The wallet cannot be reached from this page (updated, reloaded or not answering). */
  unavailable: 'unavailable',
} as const;

/** What the page is told when its content script outlived an extension reload or update. */
export const UPDATED_MESSAGE = 'BeePocket was updated. Reload this page.';
/** What the page is told when the wallet does not take a request. */
export const NOT_RESPONDING_MESSAGE = 'BeePocket is not responding. Reload this page.';
/** What the page is told when its content script cannot send a request for another reason. */
export const NOT_AVAILABLE_MESSAGE = 'BeePocket is not available.';

/**
 * How long the page waits for the wallet to take a request (its ack) before it gives up with
 * `unavailable`. Waking a suspended worker can take several seconds on a slow PC.
 */
export const ACK_TIMEOUT_MS = 10_000;
/**
 * A request that reaches the worker this long after the page sent it (`sentAt`, the page's
 * clock) is refused without acting: its ack could arrive after the page gave up, and the page
 * would never learn of a window or a broadcast it started. The margin covers the ack's way back.
 */
export const STALE_AFTER_MS = ACK_TIMEOUT_MS - 2_000;

export interface WireError {
  code: string;
  message: string;
}

/** `window.postMessage` tags of the two directions. */
export const PAGE_CHANNEL = 'beepocket:page';
export const WALLET_CHANNEL = 'beepocket:wallet';

/** The page's window event interchain-kit listens to, dispatched on every account change. */
export const KEYSTORE_EVENT = 'beepocket_keystorechange';
export const INITIALIZED_EVENT = 'beepocket#initialized';

/**
 * The relay's word to the page that the worker took a request (`{ id, ack: true }` on
 * `WALLET_CHANNEL`). The answer follows later; until the ack the page knows nothing reached
 * the wallet.
 */
export const ACK_FIELD = 'ack';

/**
 * A request from the page, as it goes through the relay to the worker. `sentAt` is the page's
 * `Date.now()` when it posted the request. A page that gave up on a request sends
 * `{ id, cancel: true }` instead.
 */
export interface WireRequest {
  id: string;
  method: string;
  params: unknown;
  sentAt?: number;
}

/** What `getKey` and `connect` answer, JSON form (`pubKey` is base64). */
export interface WireKey {
  address: string;
  bech32Address: string;
  pubKey: string;
  name: string;
  algo: 'secp256k1';
  isNanoLedger: false;
}

export function bytesToWire(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Throws on anything that is not standard base64. */
export function bytesFromWire(text: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new TypeError('not base64');
  }
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function bigintToWire(value: bigint): string {
  return value.toString(10);
}

/** uint256 max has 78 digits: longer text is refused before it reaches `BigInt()`. */
const MAX_BIGINT_DIGITS = 78;

/** Throws on anything that is not a plain non-negative decimal number of at most 78 digits. */
export function bigintFromWire(text: string): bigint {
  if (text.length > MAX_BIGINT_DIGITS || !/^(0|[1-9][0-9]*)$/.test(text))
    throw new TypeError('not a decimal number');
  return BigInt(text);
}
