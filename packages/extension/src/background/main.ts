import { ErrorCodes, fail, lockStateEvent } from '../protocol';
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
import {
  createDappService,
  dappSender,
  type DappService,
  type ActiveTabsLike,
  type SenderLike,
  type TabsLike,
  type WindowsLike,
} from '../dapp';
import { DAPP_EXPIRY_ALARM } from '../dapp/requests';
import { ChromeToolbarPopup, type ActionLike, type ContextsLike } from '../platform/toolbar-popup';
import { AddTokenService, linkSender, type LinkTabsLike } from '../features/addtoken';
import { registerHandlers } from './handlers';
import { HandlerRegistry } from './registry';
import { createServices } from './services';

export type MessageSender = SenderLike;

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
    /** Opens the toolbar popup for a request; missing on browsers without `openPopup`. */
    action?: ActionLike | undefined;
    runtime: ContextsLike & {
      id?: string | undefined;
      onMessage: MessageEventLike;
      /** Fires on install and update; the add-a-token link looks for open tabs on install. */
      onInstalled: { addListener(listener: (details: { reason: string }) => void): void };
      /** Optional: pushes lock-state events to an open popup. */
      sendMessage?: (message: unknown) => Promise<unknown>;
    };
    alarms: AlarmsLike & { onAlarm: AlarmEventLike };
    /** `query` also finds the tab the toolbar popup opened over (`activeTab`). */
    tabs: TabsLike &
      ActiveTabsLike &
      LinkTabsLike & { onRemoved: { addListener(listener: (tabId: number) => void): void } };
    windows: WindowsLike & {
      onRemoved: { addListener(listener: (windowId: number) => void): void };
    };
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
    // Two separate channels: own pages reach the popup registry, content scripts the dapp one.
    if (isOwnPage(sender, env.chrome.runtime.id)) {
      void registry()
        .then((r) => r.registry.dispatch(message))
        .catch(() => fail(ErrorCodes.internal, 'The wallet is not ready.'))
        .then(sendResponse);
      return true;
    }
    if (hasField(message, 'addToken')) {
      const link = linkSender(sender, env.chrome.runtime.id);
      if (link === null) return undefined;
      void registry()
        .then((r) => r.addToken.receive(link, (message as { addToken: unknown }).addToken))
        .catch(() => ({ error: { code: 'invalid-request', message: 'The wallet is not ready.' } }))
        .then(sendResponse);
      return true;
    }
    const dapp = dappMessage(message);
    const from = dappSender(sender, env.chrome.runtime.id);
    if (dapp === undefined || from === null) return undefined;
    void registry()
      .then((r) => r.dapp.receive(from, dapp))
      .then(
        ({ ack, after }) => {
          sendResponse(ack);
          return after();
        },
        () => {
          sendResponse({ error: { code: 'invalid-request', message: 'The wallet is not ready.' } });
        },
      )
      .catch(() => undefined);
    return true;
  });
  env.chrome.runtime.onInstalled.addListener((details) => {
    void registry()
      .then((r) => r.addToken.installed(details.reason))
      .catch(() => undefined);
  });
  env.chrome.tabs.onRemoved.addListener((tabId) => {
    void registry()
      .then((r) => r.dapp.onTabRemoved(tabId))
      .catch(() => undefined);
  });
  env.chrome.windows.onRemoved.addListener((windowId) => {
    void registry()
      .then((r) => r.dapp.onWindowRemoved(windowId))
      .catch(() => undefined);
  });
  // Alarms wake a stopped worker, so the listener is attached synchronously too.
  env.chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAPP_EXPIRY_ALARM) {
      void registry()
        .then((r) => r.dapp.onExpiry())
        .catch(() => undefined);
      return;
    }
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
  dapp: DappService;
  addToken: AddTokenService;
}

/** The `dapp` field of a content-script message, if it has one. */
function dappMessage(message: unknown): unknown {
  return hasField(message, 'dapp') ? (message as { dapp: unknown }).dapp : undefined;
}

function hasField(message: unknown, name: string): boolean {
  return typeof message === 'object' && message !== null && Object.hasOwn(message, name);
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
  const wallet = createWalletService(
    platform,
    services,
    new ChromeAlarms(env.chrome.alarms),
    (s) => {
      // Nobody listening (popup closed) rejects the send; that is fine.
      const sent = env.chrome.runtime.sendMessage?.(lockStateEvent(s.state, s.retryAt));
      void sent?.catch(() => undefined);
    },
  );
  const popup = new ChromeToolbarPopup(env.chrome.action, env.chrome.runtime);
  const dapp = createDappService(platform, services, wallet, {
    tabs: env.chrome.tabs,
    windows: env.chrome.windows,
    alarms: new ChromeAlarms(env.chrome.alarms),
    popup,
  });
  const addToken = new AddTokenService({
    session: platform.session,
    windows: env.chrome.windows,
    tabs: env.chrome.tabs,
    popup,
  });
  const registry = new HandlerRegistry();
  registerHandlers(registry, { platform, services, wallet, dapp, addToken });
  return { registry, wallet, dapp, addToken };
}
