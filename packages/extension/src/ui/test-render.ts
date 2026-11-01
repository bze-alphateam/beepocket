import { render as preactRender, type ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';

/** Renders into a host attached to the document (so focus works); call `cleanup` after. */
export function render(vnode: ComponentChildren): { host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
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

export function cleanup(): void {
  for (const host of [...document.body.children]) {
    void act(() => {
      preactRender(null, host);
    });
    host.remove();
  }
}
