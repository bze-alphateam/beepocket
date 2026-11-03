import { describe, expect, it } from 'vitest';
import { fitWalletWindow, type CurrentWindowLike, type WindowView } from './fit-window';

function rig(id: number | null = 7) {
  const updates: { id: number; width: number; height: number }[] = [];
  const windows: CurrentWindowLike = {
    getCurrent: () => Promise.resolve(id === null ? {} : { id }),
    update: (windowId, info) => {
      updates.push({ id: windowId, ...info });
      return Promise.resolve({});
    },
  };
  return { windows, updates };
}

const view = (inner: [number, number], outer: [number, number]): WindowView => ({
  innerWidth: inner[0],
  innerHeight: inner[1],
  outerWidth: outer[0],
  outerHeight: outer[1],
});

describe('fitWalletWindow', () => {
  it('grows the window by the title bar so the page gets 360 x 600 (macOS)', async () => {
    const t = rig();
    await fitWalletWindow(view([360, 572], [360, 600]), t.windows);
    expect(t.updates).toEqual([{ id: 7, width: 360, height: 628 }]);
  });

  it('adds the side borders too (Windows, Linux)', async () => {
    const t = rig();
    await fitWalletWindow(view([344, 561], [360, 600]), t.windows);
    expect(t.updates).toEqual([{ id: 7, width: 376, height: 639 }]);
  });

  it('leaves a window that already has 360 x 600 inside alone', async () => {
    const t = rig();
    await fitWalletWindow(view([360, 600], [360, 628]), t.windows);
    expect(t.updates).toEqual([]);
  });

  it('does nothing before layout or without a window id', async () => {
    const early = rig();
    await fitWalletWindow(view([0, 0], [360, 600]), early.windows);
    expect(early.updates).toEqual([]);
    const unknown = rig(null);
    await fitWalletWindow(view([360, 572], [360, 600]), unknown.windows);
    expect(unknown.updates).toEqual([]);
  });
});
