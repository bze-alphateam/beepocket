import { describe, expect, it, vi } from 'vitest';
import type { SessionStorage } from '../platform';
import type { ToolbarPopup } from '../platform/toolbar-popup';
import type { WindowBounds } from '../platform/wallet-window';
import { WINDOW_KEY } from './requests';
import { BROWSER_CALL_DEADLINE_MS, RequestWindow, type Sleeper, type WindowsLike } from './window';

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

/** Deadlines pass only when the test says so. */
function deadlines() {
  const waiting: { ms: number; pass: () => void }[] = [];
  const timer: Sleeper = {
    sleep: (ms) =>
      new Promise((resolve) => {
        waiting.push({ ms, pass: resolve });
      }),
  };
  return {
    timer,
    waiting,
    passAll: () => {
      for (const w of waiting.splice(0)) w.pass();
    },
  };
}

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

function rig(
  browser: WindowBounds | null,
  popup?: ToolbarPopup,
  opts: { timer?: Sleeper; get?: WindowsLike['get'] } = {},
) {
  const session = new MemorySession();
  const created: unknown[] = [];
  const focused: number[] = [];
  const open = new Set<number>();
  const windows: WindowsLike = {
    create: (info) => {
      created.push(info);
      open.add(created.length);
      return Promise.resolve({ id: created.length });
    },
    get:
      opts.get ??
      ((id) => (open.has(id) ? Promise.resolve({}) : Promise.reject(new Error('no window')))),
    getLastFocused: () =>
      browser === null ? Promise.reject(new Error('no window')) : Promise.resolve(browser),
    update: (id) => {
      focused.push(id);
      return Promise.resolve({});
    },
  };
  return {
    window: new RequestWindow(windows, session, popup, opts.timer),
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

  it('falls back to the window when the toolbar popup never opens', async () => {
    const d = deadlines();
    const popup: ToolbarPopup = { isOpen: () => Promise.resolve(false), open: never };
    const t = rig(null, popup, { timer: d.timer });
    const shown = t.window.show();
    await vi.waitFor(() => {
      expect(d.waiting).toHaveLength(1);
    });
    expect(d.waiting[0]?.ms).toBe(BROWSER_CALL_DEADLINE_MS);
    d.passAll();
    await shown;
    expect(t.created).toEqual([PLAIN]);
  });

  it('does not let a hung browser call block the requests behind it', async () => {
    const d = deadlines();
    const t = rig(null, undefined, { timer: d.timer, get: never });
    // A request window is remembered, but asking the browser about it never returns.
    await t.session.set(WINDOW_KEY, 7);
    let done = false;
    void Promise.all([t.window.show(), t.window.show()]).then(() => {
      done = true;
    });
    await vi.waitFor(() => {
      d.passAll();
      expect(done).toBe(true);
    });
    // Each show gave up on the silent window and opened one of its own.
    expect(t.created).toEqual([PLAIN, PLAIN]);
  });
});
