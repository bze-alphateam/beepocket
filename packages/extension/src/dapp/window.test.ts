import { describe, expect, it } from 'vitest';
import type { SessionStorage } from '../platform';
import type { WindowBounds } from '../platform/wallet-window';
import { RequestWindow, type WindowsLike } from './window';

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

function rig(browser: WindowBounds | null) {
  const created: unknown[] = [];
  const windows: WindowsLike = {
    create: (info) => {
      created.push(info);
      return Promise.resolve({ id: created.length });
    },
    get: () => Promise.reject(new Error('no window')),
    getLastFocused: () =>
      browser === null ? Promise.reject(new Error('no window')) : Promise.resolve(browser),
    update: () => Promise.resolve({}),
  };
  return { window: new RequestWindow(windows, new MemorySession()), created };
}

describe('the request window', () => {
  it('opens next to the extension icon, at the top right of the browser window', async () => {
    const t = rig({ left: 0, top: 25, width: 1440, height: 875 });
    await t.window.show();
    expect(t.created).toEqual([
      {
        url: 'popup.html?window=request',
        type: 'popup',
        width: 360,
        height: 600,
        focused: true,
        left: 1064,
        top: 105,
      },
    ]);
  });

  it('opens without a position when no browser window is known', async () => {
    const t = rig(null);
    await t.window.show();
    expect(t.created).toEqual([
      { url: 'popup.html?window=request', type: 'popup', width: 360, height: 600, focused: true },
    ]);
  });
});
