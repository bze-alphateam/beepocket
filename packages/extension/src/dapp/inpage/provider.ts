import { REQUEST_TTL_MS } from '../requests';
import {
  ACK_FIELD,
  bigintToWire,
  bytesFromWire,
  bytesToWire,
  DappErrorCodes,
  INITIALIZED_EVENT,
  KEYSTORE_EVENT,
  NOT_RESPONDING_MESSAGE,
  PAGE_CHANNEL,
  WALLET_CHANNEL,
  type WireKey,
} from '../wire';

export const PROVIDER_VERSION = '1.0.0';

/**
 * How long a request may go without the wallet's ack before it ends with `unavailable`. Waking
 * a suspended worker can take several seconds on a slow PC.
 */
export const ACK_TIMEOUT_MS = 10_000;
/**
 * How long an acked request may wait for its answer: the wallet's own 10-minute expiry plus a
 * minute. Past it the answer was lost on the way, and the request ends with `unavailable`.
 */
export const ANSWER_TIMEOUT_MS = REQUEST_TTL_MS + 60_000;

/** What a dapp gets from `connect` and `getKey`. */
export interface BeePocketKey {
  address: string;
  bech32Address: string;
  pubKey: Uint8Array;
  name: string;
  algo: 'secp256k1';
  isNanoLedger: false;
}

/** What a dapp passes to `signDirect`: the exact bytes it wants signed. */
export interface SignDoc {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}

/** What `signDirect` answers. Build the transaction from `signed`, never from the request. */
export interface DirectSignResponse {
  signed: SignDoc;
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
  signDirect(chainId: string, signer: string, signDoc: SignDoc): Promise<DirectSignResponse>;
  /** Broadcasts a signed transaction and answers its 32-byte hash. Poll for inclusion yourself. */
  sendTx(chainId: string, txBytes: Uint8Array, mode: 'sync'): Promise<Uint8Array>;
  on(event: BeePocketEvent, listener: () => void): void;
  off(event: BeePocketEvent, listener: () => void): void;
}

/** A rejection the page can branch on: `error.code` is one of `DappErrorCodes`. */
export class BeePocketError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BeePocketError';
  }
}

/** The slice of `window` the provider uses; injected so a test can drive it. */
export interface PageWindow {
  readonly location: { readonly origin: string };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(
    type: 'message',
    listener: (event: { source: unknown; origin: string; data: unknown }) => void,
  ): void;
  /** `persisted` is true when the page comes back from the back/forward cache. */
  addEventListener(type: 'pageshow', listener: (event: { persisted: boolean }) => void): void;
  dispatchEvent(event: Event): boolean;
}

/** The page's timers (`setTimeout` / `clearTimeout`); injected so a test can drive them. */
export interface PageTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ProviderDeps {
  win: PageWindow;
  timers: PageTimers;
  /** Fills `bytes` with random values (`crypto.getRandomValues`). */
  randomBytes(bytes: Uint8Array): void;
}

interface Waiting {
  resolve(value: unknown): void;
  reject(error: Error): void;
  /** The ack timer until the wallet took the request, then the answer timer. */
  timer: unknown;
}

function newId(deps: ProviderDeps): string {
  const bytes = new Uint8Array(16);
  deps.randomBytes(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toKey(raw: unknown): BeePocketKey {
  const key = raw as WireKey;
  return {
    address: key.address,
    bech32Address: key.bech32Address,
    pubKey: bytesFromWire(key.pubKey),
    name: key.name,
    algo: key.algo,
    isNanoLedger: key.isNanoLedger,
  };
}

function isBytes(x: unknown): x is Uint8Array {
  return x instanceof Uint8Array;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * The frozen object pages see as `window.beepocket`. It only turns calls into tagged
 * `postMessage`s (the content-script relay forwards them) and answers back to the caller.
 * It holds no secrets and no authority: the worker decides everything.
 */
export function createProvider(deps: ProviderDeps): BeePocketProvider {
  const { win, timers } = deps;
  const waiting = new Map<string, Waiting>();
  const listeners = new Set<() => void>();

  /** Ends a waiting request; nothing when it is not waiting (answered, or never asked). */
  const settle = (id: string, end: (pending: Waiting) => void): void => {
    const pending = waiting.get(id);
    if (!pending) return;
    waiting.delete(id);
    timers.clear(pending.timer);
    end(pending);
  };
  const unavailable = (id: string, message: string): void => {
    settle(id, (p) => {
      p.reject(new BeePocketError(DappErrorCodes.unavailable, message));
    });
  };

  // Every request ends: no ack in time means nothing reached the wallet, and an acked request
  // whose answer never comes ends after the wallet's own expiry.
  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = newId(deps);
      const timer = timers.set(() => {
        unavailable(id, NOT_RESPONDING_MESSAGE);
      }, ACK_TIMEOUT_MS);
      waiting.set(id, { resolve, reject, timer });
      win.postMessage({ channel: PAGE_CHANNEL, id, method, params }, win.location.origin);
    });

  const acked = (id: string): void => {
    const pending = waiting.get(id);
    if (!pending) return;
    timers.clear(pending.timer);
    pending.timer = timers.set(() => {
      unavailable(id, 'BeePocket did not answer. Reload this page.');
    }, ANSWER_TIMEOUT_MS);
  };

  // An answer sent while the page sat in the back/forward cache is dropped by the browser, so
  // nothing that was waiting then can still be trusted to arrive.
  win.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    for (const id of [...waiting.keys()]) {
      unavailable(id, 'The page was restored from the browser cache. Try again.');
    }
  });

  win.addEventListener('message', (event) => {
    if (event.source !== win || !isObject(event.data) || event.data.channel !== WALLET_CHANNEL) {
      return;
    }
    const { id, result, error, event: name } = event.data;
    if (name === 'accountChanged') {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // a page's listener must not stop the others
        }
      }
      win.dispatchEvent(new Event(KEYSTORE_EVENT));
      return;
    }
    if (typeof id !== 'string') return;
    if (event.data[ACK_FIELD] === true) {
      acked(id);
      return;
    }
    settle(id, (pending) => {
      if (isObject(error)) {
        const { code, message } = error;
        pending.reject(
          new BeePocketError(
            typeof code === 'string' ? code : DappErrorCodes.invalidRequest,
            typeof message === 'string' ? message : 'The request failed.',
          ),
        );
        return;
      }
      pending.resolve(result);
    });
  });

  const key = async (method: 'connect' | 'getKey', chainId: string): Promise<BeePocketKey> =>
    toKey(await request(method, { chainId }));
  const invalid = (message: string): Promise<never> =>
    Promise.reject(new BeePocketError(DappErrorCodes.invalidRequest, message));

  const signDirect = async (
    chainId: string,
    signer: string,
    signDoc: SignDoc,
  ): Promise<DirectSignResponse> => {
    let wire: unknown;
    if (!isBytes(signDoc.bodyBytes) || !isBytes(signDoc.authInfoBytes)) {
      return invalid('The signDoc is malformed.');
    }
    try {
      wire = {
        chainId,
        signer,
        signDoc: {
          bodyBytes: bytesToWire(signDoc.bodyBytes),
          authInfoBytes: bytesToWire(signDoc.authInfoBytes),
          chainId: signDoc.chainId,
          accountNumber: bigintToWire(signDoc.accountNumber),
        },
      };
    } catch {
      return invalid('The signDoc is malformed.');
    }
    const raw = (await request('signDirect', wire)) as {
      signed: { bodyBytes: string; authInfoBytes: string; chainId: string; accountNumber: string };
      signature: DirectSignResponse['signature'];
    };
    return {
      signed: {
        bodyBytes: bytesFromWire(raw.signed.bodyBytes),
        authInfoBytes: bytesFromWire(raw.signed.authInfoBytes),
        chainId: raw.signed.chainId,
        accountNumber: BigInt(raw.signed.accountNumber),
      },
      signature: raw.signature,
    };
  };

  const sendTx = async (
    chainId: string,
    txBytes: Uint8Array,
    mode: 'sync',
  ): Promise<Uint8Array> => {
    let text: string;
    if (!isBytes(txBytes)) return invalid('txBytes must be a Uint8Array.');
    try {
      text = bytesToWire(txBytes);
    } catch {
      return invalid('txBytes must be a Uint8Array.');
    }
    return bytesFromWire((await request('sendTx', { chainId, txBytes: text, mode })) as string);
  };

  return Object.freeze({
    version: PROVIDER_VERSION,
    connect: (chainId: string) => key('connect', chainId),
    getKey: (chainId: string) => key('getKey', chainId),
    signDirect,
    sendTx,
    // `accountChanged` is the only event there is.
    on(_event: BeePocketEvent, listener: () => void) {
      listeners.add(listener);
    },
    off(_event: BeePocketEvent, listener: () => void) {
      listeners.delete(listener);
    },
  });
}

/**
 * Defines `window.beepocket` (frozen, not writable, not configurable) and announces it. Does
 * nothing when the name is already taken by something that cannot be replaced.
 */
export function installProvider(deps: ProviderDeps): boolean {
  try {
    Object.defineProperty(deps.win, 'beepocket', {
      value: createProvider(deps),
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    return false;
  }
  deps.win.dispatchEvent(new Event(INITIALIZED_EVENT));
  return true;
}
