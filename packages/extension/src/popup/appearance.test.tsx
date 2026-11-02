import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { AppearanceState, type SchemeQuery } from '../theme';
import { cleanup, fireEvent, render } from '../ui/test-render';
import { AppearanceProvider, AppearanceToggle, useScheme } from './appearance';

afterEach(cleanup);

class FakeQuery implements SchemeQuery {
  private listener: (() => void) | undefined;
  constructor(public matches: boolean) {}
  addEventListener(_type: 'change', listener: () => void): void {
    this.listener = listener;
  }
  flip(matches: boolean): void {
    this.matches = matches;
    this.listener?.();
  }
}

function SchemeProbe() {
  return <output>{useScheme()}</output>;
}

describe('AppearanceToggle', () => {
  it('flips the shared appearance and saves the explicit choice', () => {
    const save = vi.fn(() => Promise.resolve());
    const state = new AppearanceState(new FakeQuery(false), save);
    const { host } = render(
      <AppearanceProvider state={state}>
        <AppearanceToggle />
        <SchemeProbe />
      </AppearanceProvider>,
    );
    const button = () => host.querySelector('button');
    expect(host.querySelector('output')?.textContent).toBe('dark');
    expect(button()?.getAttribute('aria-label')).toBe('Switch to light mode');
    fireEvent(button(), 'click');
    expect(host.querySelector('output')?.textContent).toBe('light');
    expect(button()?.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(save).toHaveBeenCalledWith('light');
  });

  it('follows the OS live while the setting is system', () => {
    const query = new FakeQuery(true);
    const state = new AppearanceState(query, undefined, 'system');
    const { host } = render(
      <AppearanceProvider state={state}>
        <SchemeProbe />
      </AppearanceProvider>,
    );
    expect(host.querySelector('output')?.textContent).toBe('dark');
    void act(() => {
      query.flip(false);
    });
    expect(host.querySelector('output')?.textContent).toBe('light');
  });

  it('shows dark outside a provider', () => {
    expect(render(<SchemeProbe />).host.textContent).toBe('dark');
  });
});
