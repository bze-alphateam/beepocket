import {
  FetchTransport,
  SystemClock,
  WebCryptoCipher,
  Argon2idKdf,
  type Cache,
  type Cipher,
  type Clock,
  type HttpTransport,
  type Kdf,
  type Random,
} from '@beepocket/core';
import { StorageCache } from './cache';
import type { SessionAreaLike, SessionStorage, Storage, StorageAreaLike } from './ports';
import { CryptoRandom } from './random';
import { ChromeSessionStorage, ChromeStorage } from './storage';

export * from './ports';
export { StorageCache } from './cache';
export { CryptoRandom } from './random';
export { ChromeSessionStorage, ChromeStorage } from './storage';

/** Everything the extension needs from the browser, behind core's interfaces. */
export interface Platform {
  storage: Storage;
  session: SessionStorage;
  cipher: Cipher;
  random: Random;
  clock: Clock;
  transport: HttpTransport;
  cache: Cache;
  kdf: Kdf;
}

/** The browser globals the platform is built from; injected so nothing reads a global itself. */
export interface PlatformEnv {
  chrome: { storage: { local: StorageAreaLike; session: SessionAreaLike } };
  crypto: Pick<Crypto, 'getRandomValues' | 'subtle'>;
  fetch: typeof fetch;
}

export async function createPlatform(env: PlatformEnv): Promise<Platform> {
  const storage = new ChromeStorage(env.chrome.storage.local);
  const clock = new SystemClock();
  return {
    storage,
    session: await ChromeSessionStorage.open(env.chrome.storage.session),
    cipher: new WebCryptoCipher(env.crypto.subtle),
    random: new CryptoRandom(env.crypto),
    clock,
    transport: new FetchTransport(env.fetch),
    cache: new StorageCache(storage, clock),
    kdf: new Argon2idKdf(),
  };
}
