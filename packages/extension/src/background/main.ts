import { ErrorCodes, fail } from '../protocol';
import { createPlatform, type PlatformEnv } from '../platform';
import { registerHandlers } from './handlers';
import { HandlerRegistry } from './registry';
import { createServices } from './services';

export interface MessageEventLike {
  addListener(
    listener: (
      message: unknown,
      sender: { id?: string | undefined },
      sendResponse: (response: unknown) => void,
    ) => boolean | undefined,
  ): void;
}

export interface BackgroundEnv extends PlatformEnv {
  chrome: PlatformEnv['chrome'] & {
    runtime: { id?: string | undefined; onMessage: MessageEventLike };
  };
}

/**
 * Composition root of the service worker: builds the platform adapters, core clients and the
 * handler registry, then answers popup messages. Listeners are attached synchronously so
 * MV3 delivers events that woke the worker; the answer waits for the platform to be ready.
 */
export function startBackground(env: BackgroundEnv): void {
  const registry = createRegistry(env);
  env.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only the extension's own pages (popup, wallet windows) may talk to the wallet.
    if (sender.id !== env.chrome.runtime.id) return undefined;
    void registry
      .then((r) => r.dispatch(message))
      .catch(() => fail(ErrorCodes.internal, 'The wallet is not ready.'))
      .then(sendResponse);
    return true;
  });
}

async function createRegistry(env: BackgroundEnv): Promise<HandlerRegistry> {
  const platform = await createPlatform(env);
  const registry = new HandlerRegistry();
  registerHandlers(registry, { platform, services: createServices(platform) });
  return registry;
}
