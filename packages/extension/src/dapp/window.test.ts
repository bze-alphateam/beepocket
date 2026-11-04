import { describe, expect, it, vi } from 'vitest';
import type { SessionStorage } from '../platform';
import type { ToolbarPopup } from '../platform/toolbar-popup';
import type { WindowBounds } from '../platform/wallet-window';
import { WINDOW_KEY } from './requests';
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

/** A promise the test settles when it likes: a browser call that answers late. */
function later<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function rig(
  browser: WindowBounds | null,
  popup?: ToolbarPopup,
  opts: { create?: WindowsLike['create'] } = {},
) {
  const session = new MemorySession();
  const created: unknown[] = [];
  const focused: number[] = [];
  const open = new Set<number>();
  const windows: WindowsLike = {
    create: (info) => {
      created.push(info);
      open.add(created.length);
      return opts.create ? opts.create(info) : Promise.resolve({ id: created.length });
    },
    get: (id) => (open.has(id) ? Promise.resolve({}) : Promise.reject(new Error('no window'))),
    getLastFocused: () =>
      browser === null ? Promise.reject(new Error('no window')) : Promise.resolve(browser),
    update: (id) => {
      focused.push(id);
      return Promise.resolve({});
    },
  };
  return {
    window: new RequestWindow(windows, session, popup),
    session,
    created,
    focused,
  };
}

function toolbar(opts: { open?: boolean; fail?: boolean } = {}) {
  let shown = 0;
  const popup: ToolbarPopup = {
    isOpen: () => Promise.resolve(opts.open === true || (shown > 0 && opts.fail !== true)),
    open: () => {
      shown++;
      return opts.fail === true ? Promise.reject(new Error('no window')) : Promise.resolve();
    },
  };
  return { popup, opened: () => shown };
}

const PLAIN = {
  url: 'popup.html?window=request',
  type: 'popup',
  width: 360,
  height: 600,
  focused: true,
};

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

  it('shows the request in the toolbar popup when the browser can open it', async () => {
    const p = toolbar();
    const t = rig({ left: 0, top: 25, width: 1440, height: 875 }, p.popup);
    await t.window.show();
    expect(p.opened()).toBe(1);
    expect(t.created).toEqual([]);
  });

  it('opens nothing more for requests arriving while the popup shows', async () => {
    const p = toolbar();
    const t = rig(null, p.popup);
    await Promise.all([t.window.show(), t.window.show(), t.window.show()]);
    expect(p.opened()).toBe(1);
    expect(t.created).toEqual([]);
  });

  it('falls back to the positioned window when the popup cannot open', async () => {
    const p = toolbar({ fail: true });
    const t = rig({ left: 0, top: 25, width: 1440, height: 875 }, p.popup);
    await t.window.show();
    expect(t.created).toEqual([{ ...PLAIN, left: 1064, top: 105 }]);
    // The window is the one place now: the next request focuses it, no popup is tried.
    await t.window.show();
    expect(p.opened()).toBe(1);
    expect(t.created).toHaveLength(1);
    expect(t.focused).toEqual([1]);
  });

  it('opens nothing more while a toolbar popup is still on its way', async () => {
    const opening = later<undefined>();
    let shown = false;
    const popup: ToolbarPopup = {
      isOpen: () => Promise.resolve(shown),
      open: () =>
        opening.promise.then(() => {
          shown = true;
        }),
    };
    const t = rig(null, popup);
    let done = false;
    void Promise.all([t.window.show(), t.window.show()]).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    expect(t.created).toEqual([]);
    // The popup opens late: the second request finds it open and adds nothing.
    opening.resolve(undefined);
    await vi.waitFor(() => {
      expect(done).toBe(true);
    });
    expect(t.created).toEqual([]);
  });

  it('remembers a window that opens late, and focuses it for the next request', async () => {
    const opening = later<{ id: number }>();
    const t = rig(null, undefined, { create: () => opening.promise });
    let done = false;
    void Promise.all([t.window.show(), t.window.show()]).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.created).toHaveLength(1);
    opening.resolve({ id: 1 });
    await vi.waitFor(() => {
      expect(done).toBe(true);
    });
    expect(t.session.data.get(WINDOW_KEY)).toBe(1);
    expect(t.created).toHaveLength(1);
    expect(t.focused).toEqual([1]);
  });
});
