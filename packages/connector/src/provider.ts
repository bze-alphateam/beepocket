/** Types of `window.beepocket`, the provider the BeePocket extension injects into pages. */

/** What `connect` and `getKey` answer. */
export interface BeePocketKey {
  address: string;
  /** Same value as `address`; interchain-kit reads this field. */
  bech32Address: string;
  pubKey: Uint8Array;
  name: string;
  algo: 'secp256k1';
  isNanoLedger: false;
}

/** The exact bytes a dapp wants signed. */
export interface BeePocketSignDoc {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}

/**
 * What `signDirect` answers. The wallet re-estimates the fee and returns its own
 * `authInfoBytes` in `signed`: build and broadcast the transaction from `signed`, never from
 * the request.
 */
export interface BeePocketDirectSignResponse {
  signed: BeePocketSignDoc;
  signature: {
    pub_key: { type: 'tendermint/PubKeySecp256k1'; value: string };
    /** Base64 of the 64-byte signature. */
    signature: string;
  };
}

export type BeePocketEvent = 'accountChanged';

export interface BeePocketProvider {
  readonly version: string;
  connect(chainId: string): Promise<BeePocketKey>;
  getKey(chainId: string): Promise<BeePocketKey>;
  signDirect(
    chainId: string,
    signer: string,
    signDoc: BeePocketSignDoc,
  ): Promise<BeePocketDirectSignResponse>;
  /** Broadcasts a signed transaction and answers its 32-byte hash. Poll for inclusion yourself. */
  sendTx(chainId: string, txBytes: Uint8Array, mode: 'sync'): Promise<Uint8Array>;
  on(event: BeePocketEvent, listener: () => void): void;
  off(event: BeePocketEvent, listener: () => void): void;
}

/**
 * The `code` of an error the provider rejects with. `unavailable`: the page cannot reach the
 * wallet (the extension was updated or reloaded, or it does not answer); reload the page.
 */
export type BeePocketErrorCode =
  | 'rejected'
  | 'locked-timeout'
  | 'not-connected'
  | 'wrong-chain'
  | 'invalid-request'
  | 'expired'
  | 'unavailable';

/** A rejection from the provider: branch on `error.code`. */
export interface BeePocketError extends Error {
  code: BeePocketErrorCode;
}

/** Dispatched on `window` once the provider is defined. */
export const BEEPOCKET_INITIALIZED_EVENT = 'beepocket#initialized';
/** Dispatched on `window` after every account change (the event interchain-kit listens to). */
export const BEEPOCKET_KEYSTORE_EVENT = 'beepocket_keystorechange';

/** The slice of `window` that `getBeePocket` uses; pass your own in a test. */
export interface ProviderHost {
  beepocket?: BeePocketProvider;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Resolves with `window.beepocket` at once if it exists, otherwise when the extension announces
 * it with `beepocket#initialized`, otherwise with `undefined` after `timeoutMs`.
 */
export function getBeePocket(
  timeoutMs = 1000,
  host: ProviderHost | undefined = typeof window === 'undefined' ? undefined : window,
): Promise<BeePocketProvider | undefined> {
  if (!host) return Promise.resolve(undefined);
  const existing = host.beepocket;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      host.removeEventListener(BEEPOCKET_INITIALIZED_EVENT, finish);
      resolve(host.beepocket);
    };
    const timer = setTimeout(finish, timeoutMs);
    host.addEventListener(BEEPOCKET_INITIALIZED_EVENT, finish);
  });
}

declare global {
  interface Window {
    /** Defined by the BeePocket extension; use `getBeePocket` to wait for it. */
    beepocket?: BeePocketProvider;
  }
}
