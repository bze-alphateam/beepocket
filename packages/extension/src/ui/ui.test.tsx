import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { cleanup, fireEvent, render } from './test-render';
import { Banner, Button, Pill, Sheet, Spinner, TextField } from '.';

afterEach(cleanup);

describe('Button', () => {
  it('renders each variant and fires onClick', () => {
    const onClick = vi.fn();
    const { host } = render(
      <>
        <Button onClick={onClick}>Go</Button>
        <Button variant="quiet">Quiet</Button>
        <Button variant="danger">Danger</Button>
      </>,
    );
    const buttons = host.querySelectorAll('button');
    // The pre-canvas variants keep their classes until every screen has moved.
    expect([...buttons].map((b) => b.className)).toEqual([
      'bp-btn bp-btn-primary',
      'bp-btn bp-btn-quiet',
      'bp-btn bp-btn-danger',
    ]);
    fireEvent(buttons[0], 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    const { host } = render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent(host.querySelector('button'), 'click');
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('links the label to the input and reports typing', () => {
    const onInput = vi.fn();
    const { host } = render(
      <TextField label="Password" value="" type="password" onInput={onInput} />,
    );
    const input = host.querySelector('input');
    expect(host.querySelector('label')?.getAttribute('for')).toBe(input?.id);
    expect(input?.type).toBe('password');
    if (input) input.value = 'abc';
    fireEvent(input, 'input');
    expect(onInput).toHaveBeenCalledWith('abc');
  });

  it('announces an error and ties it to the input', () => {
    const { host } = render(
      <TextField label="Name" value="" error="Too short" onInput={() => undefined} />,
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Too short');
    const input = host.querySelector('input');
    expect(input?.getAttribute('aria-describedby')).toBe(alert?.id);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
  });

  it('gives each field its own id', () => {
    const { host } = render(
      <>
        <TextField label="A" value="" onInput={() => undefined} />
        <TextField label="B" value="" onInput={() => undefined} />
      </>,
    );
    const [a, b] = host.querySelectorAll('input');
    expect(a?.id).not.toBe(b?.id);
  });
});

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        id="trigger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <Sheet
        open={open}
        title="Pick"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button type="button" id="first">
          One
        </button>
        <button type="button" id="last">
          Two
        </button>
      </Sheet>
    </div>
  );
}

function press(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    const { host } = render(
      <Sheet open={false} title="T" onClose={() => undefined}>
        body
      </Sheet>,
    );
    expect(host.textContent).toBe('');
  });

  it('shows a labelled dialog and focuses it on open', () => {
    const { host } = render(<Harness />);
    const trigger = host.querySelector<HTMLElement>('#trigger');
    trigger?.focus();
    fireEvent(trigger, 'click');
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Pick');
    expect(dialog?.textContent).toContain('One');
    expect(document.activeElement).toBe(dialog);
  });

  it('closes on Escape pressed anywhere in the document and returns focus to the trigger', () => {
    const onClose = vi.fn();
    const { host } = render(<Harness onClose={onClose} />);
    const trigger = host.querySelector<HTMLElement>('#trigger');
    trigger?.focus();
    fireEvent(trigger, 'click');
    void act(() => {
      press('Escape');
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a tap on the backdrop', () => {
    const onClose = vi.fn();
    const { host } = render(<Harness onClose={onClose} />);
    fireEvent(host.querySelector('#trigger'), 'click');
    fireEvent(host.querySelector('.bp-sheet-backdrop'), 'click');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    const { host } = render(<Harness />);
    fireEvent(host.querySelector('#trigger'), 'click');
    const first = host.querySelector<HTMLElement>('#first');
    const last = host.querySelector<HTMLElement>('#last');
    last?.focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(press('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // From the dialog itself, Tab enters the first control.
    host.querySelector<HTMLElement>('[role="dialog"]')?.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);
    // Focus that escaped the dialog is pulled back.
    host.querySelector<HTMLElement>('#trigger')?.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);
  });

  it('lets Tab move normally between controls in the middle', () => {
    const { host } = render(<Harness />);
    fireEvent(host.querySelector('#trigger'), 'click');
    host.querySelector<HTMLElement>('#first')?.focus();
    expect(press('Tab').defaultPrevented).toBe(false);
  });
});

describe('Pill, Spinner, Banner', () => {
  it('renders a pill', () => {
    expect(render(<Pill>New</Pill>).host.querySelector('.bp-pill')?.textContent).toBe('New');
  });

  it('exposes the spinner as a status with a name', () => {
    const el = render(<Spinner />).host.querySelector('[role="status"]');
    expect(el?.getAttribute('aria-label')).toBe('Loading');
  });

  it.each([
    ['info', 'status'],
    ['amber', 'status'],
    ['red', 'alert'],
  ] as const)('renders the %s banner as %s', (tone, role) => {
    const el = render(<Banner tone={tone}>Careful</Banner>).host.firstElementChild;
    expect(el?.className).toBe(`bp-banner bp-banner-${tone}`);
    expect(el?.getAttribute('role')).toBe(role);
    expect(el?.textContent).toBe('Careful');
  });
});
