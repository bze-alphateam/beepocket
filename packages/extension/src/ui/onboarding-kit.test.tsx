import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from './test-render';
import {
  Avatar,
  BottomBar,
  Button,
  ChoiceGrid,
  InlineNote,
  NoticeCard,
  PasswordField,
  PhraseReveal,
  RadioCardGroup,
  StrengthMeter,
  Swatches,
  TokenRow,
  WordGrid,
} from '.';

afterEach(cleanup);

function key(el: Element | null | undefined, name: string): KeyboardEvent {
  if (!el) throw new Error('no element');
  const e = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  void act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe('WordGrid typing', () => {
  it('moves to the next cell on space and keeps the space out of the word', () => {
    const { host } = render(<WordGrid words={['', '', '']} onWordInput={vi.fn()} />);
    const inputs = host.querySelectorAll('input');
    inputs[0]?.focus();
    const e = key(inputs[0], ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(inputs[1]);
    // Tab is left to the browser.
    expect(key(inputs[1], 'Tab').defaultPrevented).toBe(false);
    // The last cell has nowhere to go and stays focused.
    inputs[2]?.focus();
    key(inputs[2], ' ');
    expect(document.activeElement).toBe(inputs[2]);
  });

  it('treats several words typed or dropped into one cell like a paste', () => {
    const onWordInput = vi.fn();
    const onPaste = vi.fn();
    const { host } = render(
      <WordGrid words={['', '']} onWordInput={onWordInput} onPaste={onPaste} />,
    );
    const first = host.querySelector('input');
    if (first) first.value = 'marble echo';
    fireEvent(first, 'input');
    expect(onPaste).toHaveBeenCalledWith('marble echo', 0);
    expect(onWordInput).not.toHaveBeenCalled();
    if (first) first.value = 'marble ';
    fireEvent(first, 'input');
    expect(onWordInput).toHaveBeenCalledWith(0, 'marble');
  });
});

describe('PhraseReveal', () => {
  it('keeps the words out of the page until revealed', () => {
    const onReveal = vi.fn();
    const words = ['ember', 'lunar', 'cotton'];
    const view = (revealed: boolean) => (
      <PhraseReveal
        count={24}
        revealed={revealed}
        onReveal={onReveal}
        revealLabel="Reveal phrase"
        privacyLabel="Make sure nobody can see your screen"
      >
        <WordGrid words={words} />
      </PhraseReveal>
    );
    const { host } = render(view(false));
    expect(host.querySelectorAll('.bp-word')).toHaveLength(24);
    for (const w of words) expect(host.textContent).not.toContain(w);
    expect(host.querySelector('.bp-reveal-cells')?.getAttribute('aria-hidden')).toBe('true');
    const veil = host.querySelector('button');
    expect(veil?.textContent).toContain('Reveal phrase');
    expect(veil?.textContent).toContain('Make sure nobody can see your screen');
    fireEvent(veil, 'click');
    expect(onReveal).toHaveBeenCalledOnce();
    // The parent decides: still hidden until it passes revealed.
    expect(host.textContent).not.toContain('ember');
    cleanup();
    const shown = render(view(true)).host;
    expect(shown.textContent).toContain('ember');
    expect(shown.querySelector('.bp-reveal')).toBeNull();
  });
});

describe('ChoiceGrid', () => {
  it('is a fieldset of pressed-state tiles', () => {
    const onChange = vi.fn();
    const { host } = render(
      <ChoiceGrid
        legend="Word #3"
        options={['glide', 'cotton', 'frost']}
        value="cotton"
        onChange={onChange}
      />,
    );
    expect(host.querySelector('legend')?.textContent).toBe('Word #3');
    const tiles = [...host.querySelectorAll('button')];
    expect(tiles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(tiles[1]?.className).toBe('bp-choice-tile bp-choice-tile-on');
    fireEvent(tiles[2], 'click');
    expect(onChange).toHaveBeenCalledWith('frost');
  });
});

describe('PasswordField and StrengthMeter', () => {
  it('shows and hides the password with a named eye button', () => {
    const { host } = render(
      <PasswordField
        label="Password"
        value="secret-pass"
        onInput={vi.fn()}
        showPasswordLabel="Show password"
        hidePasswordLabel="Hide password"
        meter={<StrengthMeter level={3} label="Strong" tone="ok" />}
      />,
    );
    const input = host.querySelector('input');
    expect(input?.type).toBe('password');
    const eye = host.querySelector('button');
    expect(eye?.getAttribute('aria-label')).toBe('Show password');
    expect(eye?.getAttribute('aria-pressed')).toBe('false');
    fireEvent(eye, 'click');
    expect(host.querySelector('input')?.type).toBe('text');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Hide password');
    expect(host.querySelector('[data-icon="eye-off"]')).not.toBeNull();
    expect(host.querySelector('.bp-strength')).not.toBeNull();
  });

  it.each([
    [1, 'bad'],
    [2, 'warn'],
    [3, 'ok'],
  ] as const)('lights %i of 4 segments in the %s tone', (level, tone) => {
    const { host } = render(<StrengthMeter level={level} label="x" tone={tone} />);
    expect(host.querySelectorAll('.bp-strength-bars > span')).toHaveLength(4);
    expect(host.querySelectorAll('.bp-strength-on')).toHaveLength(level);
    expect(host.firstElementChild?.className).toBe(`bp-strength bp-strength-${tone}`);
    expect(host.querySelector('.bp-strength-label')?.textContent).toBe('x');
  });
});

describe('Swatches and TokenRow', () => {
  it('Swatches paints one decorative square per colour', () => {
    const { host } = render(<Swatches colors={['#1A0F0B', '#FB923C', '#F9A8D4']} />);
    const squares = host.querySelectorAll<HTMLElement>('.bp-swatches > span');
    expect(squares).toHaveLength(3);
    expect(squares[1]?.style.background).toBe('rgb(251, 146, 60)');
    expect(host.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('an option row is a checkbox that toggles', () => {
    const onToggle = vi.fn();
    const { host } = render(
      <TokenRow
        symbol="PAGE"
        name="Page"
        color="#FB923C"
        swatches={['#1A0F0B', '#FB923C', '#F9A8D4']}
        caption="Brand kit"
        checked
        onToggle={onToggle}
      />,
    );
    const row = host.querySelector('button');
    expect(row?.getAttribute('role')).toBe('checkbox');
    expect(row?.getAttribute('aria-checked')).toBe('true');
    expect(row?.textContent).toContain('PAGE · Page');
    expect(row?.textContent).toContain('Brand kit');
    expect(host.querySelectorAll('.bp-swatches > span')).toHaveLength(3);
    fireEvent(row, 'click');
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('a card row has no control and no swatches without a kit', () => {
    const { host } = render(
      <TokenRow variant="card" symbol="USDC" name="USD Coin" caption="No brand kit" />,
    );
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('.bp-swatches')).toBeNull();
    expect(host.querySelector('[data-icon="check"]')).not.toBeNull();
  });
});

describe('NoticeCard and BottomBar', () => {
  it('NoticeCard shows its leading, two lines and tone', () => {
    const { host } = render(
      <NoticeCard
        leading={<Avatar label="dex.getbze.com" kind="site" />}
        title="dex.getbze.com is waiting"
        sub="Unlock to see its request."
        tone="soft"
        role="status"
      />,
    );
    const card = host.firstElementChild;
    expect(card?.className).toBe('bp-notice bp-notice-soft');
    expect(card?.getAttribute('role')).toBe('status');
    expect(host.querySelector('.bp-notice-title')?.textContent).toBe('dex.getbze.com is waiting');
    expect(host.querySelector('.bp-avatar')?.textContent).toBe('D');
  });

  it('BottomBar announces its note next to the action', () => {
    const { host } = render(
      <BottomBar note="4 selected">
        <Button>Finish</Button>
      </BottomBar>,
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe('4 selected');
    expect(host.querySelector('.bp-bottom-bar > button')?.textContent).toBe('Finish');
  });
});

describe('InlineNote', () => {
  it('an error line is announced with the alert icon', () => {
    const { host } = render(<InlineNote tone="error">Word 6 is wrong.</InlineNote>);
    const line = host.querySelector('p');
    expect(line?.getAttribute('role')).toBe('alert');
    expect(line?.className).toBe('bp-field-note bp-field-error');
    expect(host.querySelector('[data-icon="alert-circle"]')).not.toBeNull();
  });

  it('a neutral line takes its own icon and is not announced', () => {
    const { host } = render(
      <InlineNote tone="neutral" icon="link">
        Filled in from a link
      </InlineNote>,
    );
    expect(host.querySelector('p')?.hasAttribute('role')).toBe(false);
    expect(host.querySelector('p')?.className).toBe('bp-field-note');
    expect(host.querySelector('[data-icon="link"]')).not.toBeNull();
  });
});

describe('RadioCardGroup with a card body', () => {
  it('leaves arrow and Home/End keys in a body field to the field', () => {
    const onChange = vi.fn();
    const { host } = render(
      <RadioCardGroup<'code' | 'manual'>
        label="How do you want to start?"
        value="code"
        onChange={onChange}
        options={[
          { value: 'code', icon: 'ticket', title: 'Code', body: <input aria-label="Token denom" /> },
          { value: 'manual', icon: 'grid', title: 'Manual' },
        ]}
      />,
    );
    const input = host.querySelector('input');
    for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(key(input, k).defaultPrevented).toBe(false);
    }
    expect(onChange).not.toHaveBeenCalled();
    // On the cards themselves the arrows still move the choice.
    key(host.querySelector('[role="radio"]'), 'ArrowDown');
    expect(onChange).toHaveBeenCalledWith('manual');
  });
});
