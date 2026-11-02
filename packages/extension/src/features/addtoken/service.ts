import type { AddTokenSource, AddTokenView } from '../../protocol';
import type { SessionStorage } from '../../platform';
import { hostOf, httpsOrigin, isKnownSite, LINK_PATTERN, validCode } from './link';
import type { LinkSender } from './sender';

export const PENDING_KEY = 'addToken.pending';
export const WINDOW_KEY = 'addToken.window';
export const DOCUMENT_KEY = 'addToken.document';

export const LINK_WINDOW_URL = 'popup.html?window=add-token';
export const INSTALL_WINDOW_URL = 'popup.html?window=onboarding';

/** The slice of `chrome.windows` the link needs; `create` also reports the window's first tab. */
export interface LinkWindowsLike {
  create(info: {
    url: string;
    type: 'popup';
    width: number;
    height: number;
    focused: boolean;
  }): Promise<
    { id?: number | undefined; tabs?: { id?: number | undefined }[] | undefined } | undefined
  >;
  get(windowId: number): Promise<unknown>;
  update(windowId: number, info: { focused: boolean }): Promise<unknown>;
}

/** The slice of `chrome.tabs` the link needs. */
export interface LinkTabsLike {
  query(info: {
    url: string;
  }): Promise<{ url?: string | undefined; lastAccessed?: number | undefined }[]>;
  update(tabId: number, info: { url: string }): Promise<unknown>;
}

export type LinkAck = { accepted: true } | { error: { code: string; message: string } };

interface Pending {
  code: string;
  referrer: string;
  source: AddTokenSource;
}

interface WindowRef {
  id: number;
  tabId?: number;
}

const refuse = (message: string): LinkAck => ({ error: { code: 'invalid-request', message } });

function isPending(x: unknown): x is Pending {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    validCode(p.code) !== null &&
    typeof p.referrer === 'string' &&
    (p.source === 'link' || p.source === 'install')
  );
}

function isWindowRef(x: unknown): x is WindowRef {
  return typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'number';
}

/**
 * The add-a-token link inside the worker. The link waits in session storage as `addToken.pending`
 * (the worker may stop while the user decides); one popup window shows it. The site that sent
 * the link is told nothing except "opened".
 */
export class AddTokenService {
  constructor(
    private readonly deps: {
      session: SessionStorage;
      windows: LinkWindowsLike;
      tabs: LinkTabsLike;
    },
  ) {}

  /** `message` is the untrusted `addToken` field of a content-script message; `from` the browser's word. */
  async receive(from: LinkSender, message: unknown): Promise<LinkAck> {
    if (typeof message !== 'object' || message === null) return refuse('Malformed link.');
    const { code, referrer } = message as Record<string, unknown>;
    const valid = validCode(code);
    if (valid === null) return refuse('Not a token code.');
    if ((await this.deps.session.get(DOCUMENT_KEY)) === from.documentId) return { accepted: true };
    await this.show(
      { code: valid, referrer: httpsOrigin(referrer) ?? '', source: 'link' },
      LINK_WINDOW_URL,
    );
    await this.deps.session.set(DOCUMENT_KEY, from.documentId);
    return { accepted: true };
  }

  /**
   * First install: the add page may already be open in a tab the content script never reached.
   * The most recently used tab with a valid code wins; its `from` is display text only.
   */
  async installed(reason: string): Promise<void> {
    if (reason !== 'install') return;
    const tabs = await this.deps.tabs.query({ url: LINK_PATTERN });
    const newest = [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    for (const tab of newest) {
      const read = readLink(tab.url);
      if (read === null) continue;
      await this.show({ ...read, source: 'install' }, INSTALL_WINDOW_URL);
      return;
    }
  }

  async current(): Promise<AddTokenView> {
    const stored = await this.deps.session.get(PENDING_KEY);
    if (!isPending(stored)) return { status: 'none' };
    // A link that arrived during install is always unknown: its `from` could be anything.
    const known = stored.source === 'link' && isKnownSite(stored.referrer);
    const host = hostOf(stored.referrer);
    return { status: 'link', source: stored.source, code: stored.code, host, known };
  }

  async clear(): Promise<void> {
    await this.deps.session.remove(PENDING_KEY);
  }

  /** Saves the link and opens the window, or reloads and focuses the one that is open. */
  private async show(pending: Pending, url: string): Promise<void> {
    await this.deps.session.set(PENDING_KEY, pending);
    const stored = await this.deps.session.get(WINDOW_KEY);
    if (isWindowRef(stored)) {
      try {
        await this.deps.windows.get(stored.id);
        // Reload so a new link never leaves the old token showing. A window whose tab is not
        // known cannot be reloaded: a fresh one replaces it below.
        if (stored.tabId !== undefined) {
          await this.deps.tabs.update(stored.tabId, { url });
          await this.deps.windows.update(stored.id, { focused: true });
          return;
        }
      } catch {
        // closed since: open a new one
      }
    }
    const created = await this.deps.windows.create({
      url,
      type: 'popup',
      width: 360,
      height: 600,
      focused: true,
    });
    if (created?.id !== undefined) {
      const tabId = created.tabs?.[0]?.id;
      await this.deps.session.set(WINDOW_KEY, {
        id: created.id,
        ...(tabId === undefined ? {} : { tabId }),
      });
    }
  }
}

function readLink(url: string | undefined): { code: string; referrer: string } | null {
  if (url === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const code = validCode(parsed.searchParams.get('code'));
  if (code === null) return null;
  return { code, referrer: httpsOrigin(parsed.searchParams.get('from')) ?? '' };
}
