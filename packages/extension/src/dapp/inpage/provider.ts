import {
  bytesFromWire,
  DappErrorCodes,
  INITIALIZED_EVENT,
  KEYSTORE_EVENT,
  PAGE_CHANNEL,
  WALLET_CHANNEL,
  type WireKey,
} from '../wire';

export const PROVIDER_VERSION = '1.0.0';

/** What a dapp gets from `connect` and `getKey`. */
export interface BeePocketKey {
  address: string;
  bech32Address: string;
  pubKey: Uint8Array;
  name: string;
  algo: 'secp256k1';
  isNanoLedger: false;
}

export type BeePocketEvent = 'accountChanged';

export interface BeePocketProvider {
  readonly version: string;
  connect(chainId: string): Promise<BeePocketKey>;
  getKey(chainId: string): Promise<BeePocketKey>;
  signDirect(chainId: string, signer: string, signDoc: unknown): Promise<never>;
  sendTx(chainId: string, txBytes: Uint8Array, mode: 'sync'): Promise<never>;
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
  dispatchEvent(event: Event): boolean;
}

export interface ProviderDeps {
  win: PageWindow;
  /** Fills `bytes` with random values (`crypto.getRandomValues`). */
  randomBytes(bytes: Uint8Array): void;
}

interface Waiting {
  resolve(value: unknown): void;
  reject(error: Error): void;
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

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * The frozen object pages see as `window.beepocket`. It only turns calls into tagged
 * `postMessage`s (the content-script relay forwards them) and answers back to the caller.
 * It holds no secrets and no authority: the worker decides everything.
 */
export function createProvider(deps: ProviderDeps): BeePocketProvider {
  const { win } = deps;
  const waiting = new Map<string, Waiting>();
  const listeners = new Set<() => void>();

  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = newId(deps);
      waiting.set(id, { resolve, reject });
      win.postMessage({ channel: PAGE_CHANNEL, id, method, params }, win.location.origin);
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
    const pending = waiting.get(id);
    if (!pending) return;
    waiting.delete(id);
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

  const key = async (method: 'connect' | 'getKey', chainId: string): Promise<BeePocketKey> =>
    toKey(await request(method, { chainId }));
  const unsupported = (): Promise<never> =>
    Promise.reject(new BeePocketError(DappErrorCodes.invalidRequest, 'Not supported yet'));

  return Object.freeze({
    version: PROVIDER_VERSION,
    connect: (chainId: string) => key('connect', chainId),
    getKey: (chainId: string) => key('getKey', chainId),
    signDirect: unsupported,
    sendTx: unsupported,
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
