import { describe, expect, it } from 'vitest';
import type { SessionStorage } from '../../platform';
import { AddTokenService, type LinkTabsLike, type LinkWindowsLike } from './service';

class MemorySession implements SessionStorage {
  readonly data = new Map<string, unknown>();
  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.get(key));
  }
  set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  setMany(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.data.set(k, v);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

interface Tab {
  url?: string;
  lastAccessed?: number;
}

function rig(tabs: Tab[] = []) {
  const session = new MemorySession();
  const open = new Set<number>();
  const created: { url: string; width: number; height: number }[] = [];
  const focused: number[] = [];
  const reloaded: { tabId: number; url: string }[] = [];
  let next = 10;
  const windows: LinkWindowsLike = {
    create: (info) => {
      const id = next++;
      open.add(id);
      created.push({ url: info.url, width: info.width, height: info.height });
      return Promise.resolve({ id, tabs: [{ id: id * 100 }] });
    },
    get: (id) => (open.has(id) ? Promise.resolve({}) : Promise.reject(new Error('no window'))),
    update: (id) => {
      focused.push(id);
      return Promise.resolve({});
    },
  };
  const link: LinkTabsLike = {
    query: () => Promise.resolve(tabs),
    update: (tabId, info) => {
      reloaded.push({ tabId, url: info.url });
      return Promise.resolve({});
    },
  };
  const service = new AddTokenService({ session, windows, tabs: link });
  return { service, session, open, created, focused, reloaded };
}

const GOLD = 'factory/bze1abc/gold';

describe('a link from the add page', () => {
  it('saves the link and opens a 360 x 600 window on the Add screen', async () => {
    const t = rig();
    const ack = await t.service.receive(
      { documentId: 'd1' },
      { code: GOLD, referrer: 'https://dex.getbze.com' },
    );
    expect(ack).toEqual({ accepted: true });
    expect(t.created).toEqual([{ url: 'popup.html?window=add-token', width: 360, height: 600 }]);
    expect(await t.service.current()).toEqual({
      status: 'link',
      source: 'link',
      code: GOLD,
      host: 'dex.getbze.com',
      known: true,
    });
  });

  it.each([
    ['evilgetbze.com', 'https://evilgetbze.com', false],
    ['dex.getbze.com', 'https://dex.getbze.com', true],
    ['getbze.com', 'https://getbze.com', true],
    ['an empty referrer', '', false],
    ['a non-https referrer', 'http://dex.getbze.com', false],
    ['junk', 'javascript:alert(1)', false],
  ])('treats %s as known=%s', async (_name, referrer, known) => {
    const t = rig();
    await t.service.receive({ documentId: 'd1' }, { code: GOLD, referrer });
    const view = await t.service.current();
    expect(view).toMatchObject({ status: 'link', known });
    if (referrer === '' || !referrer.startsWith('https:'))
      expect(view).toMatchObject({ host: null });
  });

  it.each([
    ['a missing code', { referrer: '' }],
    ['a bad character', { code: 'factory/bze1abc/go$d', referrer: '' }],
    ['an over-long code', { code: `a${'b'.repeat(128)}`, referrer: '' }],
    ['not an object', 'ubze'],
    ['null', null],
  ])('refuses %s and opens nothing', async (_name, message) => {
    const t = rig();
    const ack = await t.service.receive({ documentId: 'd1' }, message);
    expect(ack).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.created).toEqual([]);
    expect(await t.service.current()).toEqual({ status: 'none' });
  });

  it('replaces the link and focuses the window that is already open', async () => {
    const t = rig();
    await t.service.receive({ documentId: 'd1' }, { code: GOLD, referrer: '' });
    await t.service.receive({ documentId: 'd2' }, { code: 'ubze', referrer: 'https://getbze.com' });
    expect(t.created).toHaveLength(1);
    expect(t.focused).toEqual([10]);
    expect(t.reloaded).toEqual([{ tabId: 1000, url: 'popup.html?window=add-token' }]);
    expect(await t.service.current()).toMatchObject({ code: 'ubze', host: 'getbze.com' });
  });

  it('opens a new window when the old one was closed', async () => {
    const t = rig();
    await t.service.receive({ documentId: 'd1' }, { code: GOLD, referrer: '' });
    t.open.clear();
    await t.service.receive({ documentId: 'd2' }, { code: GOLD, referrer: '' });
    expect(t.created).toHaveLength(2);
  });

  it('opens once per document', async () => {
    const t = rig();
    const message = { code: GOLD, referrer: '' };
    await t.service.receive({ documentId: 'd1' }, message);
    t.open.clear();
    const again = await t.service.receive({ documentId: 'd1' }, { ...message, code: 'ubze' });
    expect(again).toEqual({ accepted: true });
    expect(t.created).toHaveLength(1);
    expect(await t.service.current()).toMatchObject({ code: GOLD });
  });

  it('forgets the link once the user is done', async () => {
    const t = rig();
    await t.service.receive({ documentId: 'd1' }, { code: GOLD, referrer: '' });
    await t.service.clear();
    expect(await t.service.current()).toEqual({ status: 'none' });
  });
});

describe('first install', () => {
  const tab = (code: string, lastAccessed?: number, from?: string): Tab => ({
    url: `https://getbze.com/wallet/add/?code=${encodeURIComponent(code)}${
      from === undefined ? '' : `&from=${encodeURIComponent(from)}`
    }`,
    ...(lastAccessed === undefined ? {} : { lastAccessed }),
  });

  it('picks the most recently used tab and opens onboarding with its code', async () => {
    const t = rig([tab('ubze', 100), tab(GOLD, 300), tab('factory/bze1abc/old', 200)]);
    await t.service.installed('install');
    expect(t.created).toEqual([{ url: 'popup.html?window=onboarding', width: 360, height: 600 }]);
    expect(await t.service.current()).toMatchObject({ source: 'install', code: GOLD });
  });

  it('ignores an update, a browser update and a missing tab', async () => {
    const withTab = rig([tab(GOLD, 1)]);
    await withTab.service.installed('update');
    await withTab.service.installed('chrome_update');
    const noTab = rig([]);
    await noTab.service.installed('install');
    expect(withTab.created).toEqual([]);
    expect(noTab.created).toEqual([]);
    expect(await noTab.service.current()).toEqual({ status: 'none' });
  });

  it('skips tabs without a valid code', async () => {
    const t = rig([tab('bad code', 500), { lastAccessed: 400 }, tab(GOLD, 100)]);
    await t.service.installed('install');
    expect(await t.service.current()).toMatchObject({ code: GOLD });
  });

  it('does nothing when no tab holds a valid code', async () => {
    const t = rig([tab('bad code', 500), { url: 'https://getbze.com/wallet/add/' }]);
    await t.service.installed('install');
    expect(t.created).toEqual([]);
  });

  it('drops a bad from and never calls the link known', async () => {
    const bad = rig([tab(GOLD, 1, 'javascript:alert(1)')]);
    await bad.service.installed('install');
    expect(await bad.service.current()).toMatchObject({ host: 'getbze.com', known: false });

    const insecure = rig([tab(GOLD, 1, 'http://dex.getbze.com')]);
    await insecure.service.installed('install');
    expect(await insecure.service.current()).toMatchObject({ host: 'getbze.com', known: false });

    const claimed = rig([tab(GOLD, 1, 'https://dex.getbze.com')]);
    await claimed.service.installed('install');
    expect(await claimed.service.current()).toMatchObject({
      host: 'dex.getbze.com',
      known: false,
    });
  });
});
