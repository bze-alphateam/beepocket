import { describe, expect, it, vi } from 'vitest';
import { ChromeToolbarPopup, showInPopup, type ToolbarPopup } from './toolbar-popup';

describe('ChromeToolbarPopup', () => {
  it('opens the popup through chrome.action', async () => {
    const openPopup = vi.fn(() => Promise.resolve());
    await new ChromeToolbarPopup({ openPopup }, {}).open();
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it('rejects when the browser has no openPopup or no action at all', async () => {
    await expect(new ChromeToolbarPopup({}, {}).open()).rejects.toThrow();
    await expect(new ChromeToolbarPopup(undefined, {}).open()).rejects.toThrow();
  });

  it('asks the runtime for an open popup context', async () => {
    const getContexts = vi.fn(() => Promise.resolve([{}]));
    await expect(new ChromeToolbarPopup({}, { getContexts }).isOpen()).resolves.toBe(true);
    expect(getContexts).toHaveBeenCalledWith({ contextTypes: ['POPUP'] });
    const none = { getContexts: () => Promise.resolve([]) };
    await expect(new ChromeToolbarPopup({}, none).isOpen()).resolves.toBe(false);
  });

  it('counts the popup as closed when the runtime cannot tell', async () => {
    await expect(new ChromeToolbarPopup({}, {}).isOpen()).resolves.toBe(false);
    const failing = { getContexts: () => Promise.reject(new Error('no')) };
    await expect(new ChromeToolbarPopup({}, failing).isOpen()).resolves.toBe(false);
  });
});

function popup(opts: { open?: boolean; fail?: boolean } = {}) {
  const calls = { open: 0 };
  const p: ToolbarPopup = {
    isOpen: () => Promise.resolve(opts.open === true),
    open: () => {
      calls.open++;
      return opts.fail === true ? Promise.reject(new Error('no window')) : Promise.resolve();
    },
  };
  return { popup: p, calls };
}

describe('showInPopup', () => {
  it('opens the popup', async () => {
    const t = popup();
    await expect(showInPopup(t.popup)).resolves.toBe(true);
    expect(t.calls.open).toBe(1);
  });

  it('leaves a popup that is already open alone', async () => {
    const t = popup({ open: true });
    await expect(showInPopup(t.popup)).resolves.toBe(true);
    expect(t.calls.open).toBe(0);
  });

  it('says false when the popup cannot open or there is none', async () => {
    await expect(showInPopup(popup({ fail: true }).popup)).resolves.toBe(false);
    await expect(showInPopup(undefined)).resolves.toBe(false);
  });
});
