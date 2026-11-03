import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropdownSheet, ScreenHeader, SettingsRow, Sheet, SiteCard } from '.';
import { cleanup, fireEvent, render } from './test-render';

afterEach(cleanup);

const key = (k: string) => {
  fireEvent(document.body, 'keydown', { key: k });
};

describe('SettingsRow', () => {
  it('is a button with the icon, title and a muted value', () => {
    const onClick = vi.fn();
    const { host } = render(
      <SettingsRow icon="grid" title="Preferred tokens" value="4" onClick={onClick} />,
    );
    const row = host.querySelector('button.bp-settings-row');
    expect(row?.querySelector('svg')).not.toBeNull();
    expect(row?.querySelector('.bp-settings-row-value')?.textContent).toBe('4');
    fireEvent(row, 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('draws a note fainter, takes an accessible name, and a sub line', () => {
    const { host } = render(
      <>
        <SettingsRow
          title="Show recovery phrase"
          value="Password needed"
          note
          onClick={() => undefined}
        />
        <SettingsRow
          title="Connected sites"
          value="3"
          label="Connected sites · 3"
          onClick={() => undefined}
        />
        <SettingsRow title="Lock sending after" sub="Asks for the password again" />
      </>,
    );
    expect(host.querySelector('.bp-settings-row-note')?.textContent).toBe('Password needed');
    expect(host.querySelectorAll('button')[1]?.getAttribute('aria-label')).toBe(
      'Connected sites · 3',
    );
    expect(host.querySelector('.bp-settings-row-sub')?.textContent).toBe(
      'Asks for the password again',
    );
  });

  it('without onClick is a plain row holding a control', () => {
    const { host } = render(
      <SettingsRow title="Appearance">
        <span class="control">x</span>
      </SettingsRow>,
    );
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('.bp-settings-row-control .control')).not.toBeNull();
  });
});

describe('Sheet', () => {
  it('always has a × in the title row that closes it, and no handle', () => {
    const onClose = vi.fn();
    const { host } = render(
      <Sheet open title="Settings" onClose={onClose}>
        body
      </Sheet>,
    );
    expect(host.querySelector('.bp-sheet-handle')).toBeNull();
    const close = host.querySelector('.bp-sheet-head button[aria-label="Close"]');
    expect(close).not.toBeNull();
    fireEvent(close, 'click');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on the backdrop', () => {
    const onClose = vi.fn();
    const { host } = render(
      <Sheet open title="Settings" onClose={onClose}>
        body
      </Sheet>,
    );
    fireEvent(host.querySelector('.bp-sheet-backdrop'), 'click');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a dropdown opened inside a sheet takes Escape, then the sheet does', () => {
    function Outer() {
      const [open, setOpen] = useState(true);
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <Sheet
          open={open}
          title="Lock timers"
          onClose={() => {
            setOpen(false);
          }}
        >
          <DropdownSheet
            title="Lock sending after"
            value={v}
            onChange={setV}
            options={[
              { value: 'a', label: '5 min' },
              { value: 'b', label: '15 min' },
            ]}
          />
        </Sheet>
      );
    }
    const { host } = render(<Outer />);
    const dialogs = () =>
      [...host.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('aria-label'));
    fireEvent(host.querySelector('.bp-dropdown'), 'click');
    expect(dialogs()).toEqual(['Lock timers', 'Lock sending after']);
    key('Escape');
    expect(dialogs()).toEqual(['Lock timers']);
    key('Escape');
    expect(dialogs()).toEqual([]);
  });

  it("a dropdown's × inside a sheet closes only the dropdown", () => {
    function Outer() {
      const [open, setOpen] = useState(true);
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <Sheet
          open={open}
          title="Lock timers"
          onClose={() => {
            setOpen(false);
          }}
        >
          <DropdownSheet
            title="Lock sending after"
            value={v}
            onChange={setV}
            options={[
              { value: 'a', label: '5 min' },
              { value: 'b', label: '15 min' },
            ]}
          />
        </Sheet>
      );
    }
    const { host } = render(<Outer />);
    const dialogs = () => [...host.querySelectorAll('[role="dialog"]')];
    fireEvent(host.querySelector('.bp-dropdown'), 'click');
    const nested = dialogs().find((d) => d.getAttribute('aria-label') === 'Lock sending after');
    fireEvent(nested?.querySelector('[aria-label="Close"]'), 'click');
    expect(dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Lock timers']);
  });
});

describe('ScreenHeader', () => {
  it('has no ← when there is no way back', () => {
    const { host } = render(<ScreenHeader title="Pick your tokens" />);
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('.bp-screen-header-plain h1')?.textContent).toBe('Pick your tokens');
  });
});

describe('SiteCard', () => {
  it('md draws the 40 px avatar of a Connected sites card', () => {
    const { host } = render(
      <SiteCard origin="https://dex.getbze.com" size="md" aside={<b>x</b>} />,
    );
    const avatar = host.querySelector<HTMLElement>('.bp-site-card-md .bp-avatar');
    expect(avatar?.style.width).toBe('40px');
    expect(host.textContent).toContain('dex.getbze.com');
  });
});
