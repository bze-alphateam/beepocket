import { ErrorCodes, fail } from '../protocol';
import { createPlatform, type PlatformEnv } from '../platform';
import {
  ChromeAlarms,
  createWalletService,
  type AlarmEventLike,
  type AlarmsLike,
  SESSION_KEY,
  SESSION_PROFILE,
  type WalletService,
} from '../features/wallet';
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
    alarms: AlarmsLike & { onAlarm: AlarmEventLike };
  };
}

/**
 * Composition root of the service worker: builds the platform adapters, core clients and the
 * handler registry, then answers popup messages. Listeners are attached synchronously so
 * MV3 delivers events that woke the worker. The registry is built on the first message and
 * a failed start is forgotten, so the next message retries.
 */
export function startBackground(env: BackgroundEnv): void {
  let pending: Promise<Started> | undefined;
  const registry = (): Promise<Started> => {
    pending ??= createRegistry(env).catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
    return pending;
  };
  env.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isOwnPage(sender, env.chrome.runtime.id)) return undefined;
    void registry()
      .then((r) => r.registry.dispatch(message))
      .catch(() => fail(ErrorCodes.internal, 'The wallet is not ready.'))
      .then(sendResponse);
    return true;
  });
  // Alarms wake a stopped worker, so the listener is attached synchronously too.
  env.chrome.alarms.onAlarm.addListener((alarm) => {
    void registry()
      .then((r) => r.wallet.onAlarm(alarm.name))
      .catch(() => retryLock(env, alarm.name));
  });
}

/**
 * An auto-lock that failed must not leave the wallet open: try the service once more, then
 * drop the session secrets directly. Nothing is logged (the reason may carry secrets).
 */
async function retryLock(env: BackgroundEnv, alarm: string): Promise<void> {
  try {
    const { wallet } = await createRegistry(env);
    await wallet.onAlarm(alarm);
    return;
  } catch {
    // fall through to the direct clear
  }
  const session = env.chrome.storage.session;
  const keys = alarm === 'weak-lock' ? [SESSION_KEY] : [SESSION_KEY, SESSION_PROFILE];
  for (const key of keys) await session.remove(key).catch(() => undefined);
}

interface Started {
  registry: HandlerRegistry;
  wallet: WalletService;
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

async function createRegistry(env: BackgroundEnv): Promise<Started> {
  const platform = await createPlatform(env);
  const services = createServices(platform);
  const wallet = createWalletService(platform, services, new ChromeAlarms(env.chrome.alarms));
  const registry = new HandlerRegistry();
  registerHandlers(registry, { platform, services, wallet });
  return { registry, wallet };
}
