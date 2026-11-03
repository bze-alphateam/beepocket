import { describe, expect, it } from 'vitest';
import {
  openWalletWindow,
  type WalletWindowCreate,
  type WalletWindowsLike,
  type WindowBounds,
} from './wallet-window';

function rig(browser: WindowBounds | Error, opts: { refusePosition?: boolean } = {}) {
  const created: WalletWindowCreate[] = [];
  const asked: unknown[] = [];
  const windows: WalletWindowsLike<{ id: number }> = {
    create: (info) => {
      created.push(info);
      if (opts.refusePosition === true && info.left !== undefined) {
        return Promise.reject(new Error('Invalid value for bounds'));
      }
      return Promise.resolve({ id: created.length });
    },
    getLastFocused: (info) => {
      asked.push(info);
      return browser instanceof Error ? Promise.reject(browser) : Promise.resolve(browser);
    },
  };
  return { windows, created, asked };
}

const REQUEST = 'popup.html?window=request';
const PLAIN = { url: REQUEST, type: 'popup', width: 360, height: 600, focused: true };

describe('openWalletWindow', () => {
  it('opens 360 x 600 at the top right of the last focused browser window', async () => {
    const t = rig({ left: 100, top: 50, width: 1200, height: 800, state: 'normal' });
    await expect(openWalletWindow(t.windows, REQUEST)).resolves.toEqual({ id: 1 });
    expect(t.asked).toEqual([{ windowTypes: ['normal'] }]);
    expect(t.created).toEqual([{ ...PLAIN, left: 924, top: 130 }]);
  });

  it('keeps negative coordinates of a display left of the main one', async () => {
    const t = rig({ left: -1920, top: -200, width: 1920, height: 1080 });
    await openWalletWindow(t.windows, REQUEST);
    expect(t.created).toEqual([{ ...PLAIN, left: -376, top: -120 }]);
  });

  it('aligns to the left edge of a browser window narrower than the wallet', async () => {
    const t = rig({ left: 40, top: 10, width: 300, height: 900 });
    await openWalletWindow(t.windows, REQUEST);
    expect(t.created).toEqual([{ ...PLAIN, left: 40, top: 90 }]);
  });

  it('moves up so the bottom stays inside a short browser window', async () => {
    const t = rig({ left: 0, top: 100, width: 1000, height: 640 });
    await openWalletWindow(t.windows, REQUEST);
    expect(t.created).toEqual([{ ...PLAIN, left: 624, top: 140 }]);
  });

  it('never goes above the top of a browser window shorter than the wallet', async () => {
    const t = rig({ left: 0, top: 100, width: 1000, height: 400 });
    await openWalletWindow(t.windows, REQUEST);
    expect(t.created).toEqual([{ ...PLAIN, left: 624, top: 100 }]);
  });

  it.each([
    ['no browser window', new Error('No last-focused window')],
    ['missing bounds', { left: 0, top: 0 }],
    [
      'a minimized browser window',
      { left: 0, top: 0, width: 1000, height: 800, state: 'minimized' },
    ],
  ])('lets the browser place it with %s', async (_name, browser) => {
    const t = rig(browser);
    await openWalletWindow(t.windows, REQUEST);
    expect(t.created).toEqual([PLAIN]);
  });

  it('opens it without a position when the browser refuses the bounds', async () => {
    const t = rig({ left: 0, top: 0, width: 1000, height: 800 }, { refusePosition: true });
    await expect(openWalletWindow(t.windows, REQUEST)).resolves.toEqual({ id: 2 });
    expect(t.created).toEqual([{ ...PLAIN, left: 624, top: 80 }, PLAIN]);
  });
});
