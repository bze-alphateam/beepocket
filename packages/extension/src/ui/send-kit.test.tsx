import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from './test-render';
import { Avatar, Field, FieldAction, ResultLayout, SelectRow } from '.';

afterEach(cleanup);

describe('SelectRow', () => {
  it('is one named button with its text, value and a chevron, and opens on click', () => {
    const onClick = vi.fn();
    const { host } = render(
      <SelectRow
        label="From Main. Change address"
        title="Main"
        subtitle="bze1q8…y4x4kf"
        value="8,240.10 BZE"
        onClick={onClick}
      />,
    );
    const button = host.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('From Main. Change address');
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button?.className).toBe('bp-select-row bp-select-row-field');
    expect(host.querySelector('.bp-select-row-title')?.textContent).toBe('Main');
    expect(host.querySelector('.bp-select-row-sub')?.classList.contains('bp-mono')).toBe(true);
    expect(host.querySelector('.bp-select-row-value')?.textContent).toBe('8,240.10 BZE');
    expect(host.querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    fireEvent(button, 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('quiet tone shows a caption and the value icon, and a disabled row does not open', () => {
    const onClick = vi.fn();
    const { host } = render(
      <SelectRow
        tone="quiet"
        label="Network fee"
        caption="Network fee"
        valueIcon={<Avatar label="BZE" size={18} />}
        value="≈ 0.012 BZE"
        disabled
        onClick={onClick}
      />,
    );
    expect(host.querySelector('button')?.className).toBe('bp-select-row bp-select-row-quiet');
    expect(host.querySelector('.bp-select-row-caption')?.textContent).toBe('Network fee');
    expect(host.querySelector('.bp-avatar')).not.toBeNull();
    expect(host.querySelector('.bp-select-row-text')).toBeNull();
    fireEvent(host.querySelector('button'), 'click');
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('FieldAction', () => {
  it('is a named icon button inside the field box', () => {
    const onClick = vi.fn();
    const { host } = render(
      <Field
        label="To"
        value=""
        onInput={() => undefined}
        trailing={<FieldAction icon="book" label="Open address book" onClick={onClick} />}
      />,
    );
    const action = host.querySelector('.bp-field-box > .bp-field-action');
    expect(action?.getAttribute('aria-label')).toBe('Open address book');
    expect(action?.querySelector('[data-icon="book"]')).not.toBeNull();
    fireEvent(action, 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('ResultLayout pending', () => {
  it('keeps the link and the pinned actions under the ring (a send still pending)', () => {
    const { host } = render(
      <ResultLayout
        status="pending"
        title="Still pending"
        link={<a href="https://scan/x">View on Explorer</a>}
        actions={<button type="button">Done</button>}
      />,
    );
    expect(host.querySelector('.bp-result-ring')).not.toBeNull();
    expect(host.querySelector('.bp-result-link a')?.getAttribute('href')).toBe('https://scan/x');
    expect(host.querySelector('.bp-bottom button')?.textContent).toBe('Done');
  });
});
