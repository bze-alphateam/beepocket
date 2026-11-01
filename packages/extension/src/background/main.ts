import { ErrorCodes, fail } from '../protocol';
import { createPlatform, type PlatformEnv } from '../platform';
import { registerHandlers } from './handlers';
import { HandlerRegistry } from './registry';
import { createServices } from './services';

export interface MessageSender {
  id?: string | undefined;
  url?: string | undefined;
  tab?: unknown;
}

export interface MessageEventLike {
  addListener(
    listener: (
      message: unknown,
      sender: MessageSender,
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
 * MV3 delivers events that woke the worker. The registry is built on the first message and
 * a failed start is forgotten, so the next message retries.
 */
export function startBackground(env: BackgroundEnv): void {
  let pending: Promise<HandlerRegistry> | undefined;
  const registry = (): Promise<HandlerRegistry> => {
    pending ??= createRegistry(env).catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
  env.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isOwnPage(sender, env.chrome.runtime.id)) return undefined;
    void registry()
      .then((r) => r.dispatch(message))
      .catch(() => fail(ErrorCodes.internal, 'The wallet is not ready.'))
      .then(sendResponse);
    return true;
  });
}

/**
 * Only the extension's own pages (popup, wallet windows) may talk to the wallet. A content
 * script carries the extension id too, but its `url` is the web page's, so the url prefix
 * rejects it. `sender.tab` is not checked: an own page opened as a tab or a popup window has one.
 */
function isOwnPage(sender: MessageSender, id: string | undefined): boolean {
  if (id === undefined || sender.id !== id) return false;
  return sender.url?.startsWith(`chrome-extension://${id}/`) === true;
}

async function createRegistry(env: BackgroundEnv): Promise<HandlerRegistry> {
  const platform = await createPlatform(env);
  const registry = new HandlerRegistry();
  registerHandlers(registry, { platform, services: createServices(platform) });
  return registry;
}
