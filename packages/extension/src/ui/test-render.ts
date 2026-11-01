import { render as preactRender, type ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';

/** Renders into a detached host and flushes effects; shared by the UI tests. */
export function render(vnode: ComponentChildren): { host: HTMLElement } {
  const host = document.createElement('div');
  void act(() => {
    preactRender(vnode, host);
  });
  return { host };
}

export function fireEvent(el: Element | null | undefined, type: string, init: object = {}): void {
  if (!el) throw new Error('no element to fire on');
  void act(() => {
    // click() honours `disabled`, like a real tap.
    if (type === 'click' && el instanceof HTMLElement) el.click();
    else el.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), init));
  });
}
