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
} as const;

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

/** A request from the page, as it goes through the relay to the worker. */
export interface WireRequest {
  id: string;
  method: string;
  params: unknown;
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
