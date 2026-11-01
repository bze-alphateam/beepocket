import { fireEvent, render } from './test-render';
import { describe, expect, it, vi } from 'vitest';
import { Banner, Button, Pill, Sheet, Spinner, TextField } from '.';

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

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    const { host } = render(
      <Sheet open={false} title="T" onClose={() => undefined}>
        body
      </Sheet>,
    );
    expect(host.textContent).toBe('');
  });

  it('shows a labelled dialog and closes on backdrop and Escape', () => {
    const onClose = vi.fn();
    const { host } = render(
      <Sheet open title="Pick" onClose={onClose}>
        body
      </Sheet>,
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Pick');
    expect(dialog?.textContent).toContain('body');
    fireEvent(host.querySelector('.bp-sheet-backdrop'), 'click');
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent(dialog, 'keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
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
