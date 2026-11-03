import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { cleanup, fireEvent, render } from './test-render';
import {
  AppearanceButton,
  Avatar,
  BottomActions,
  Button,
  Card,
  Check,
  DetailRow,
  DropdownSheet,
  EmptyState,
  Field,
  FieldSuffix,
  HomeHeader,
  Icon,
  ICON_NAMES,
  IconTile,
  ListRow,
  Logo,
  OnboardingHeader,
  RadioCardGroup,
  ResultLayout,
  ScreenHeader,
  Segmented,
  SettingsButton,
  Sheet,
  Toast,
  Toggle,
  TokenPill,
  TokenTitle,
  WordGrid,
} from '.';

afterEach(cleanup);

const byText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent === text);

describe('Icon', () => {
  it.each(ICON_NAMES)('renders %s as a decorative 24-unit SVG', (name) => {
    const svg = render(<Icon name={name} />).host.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it('names an icon for screen readers when labelled and takes a size', () => {
    const svg = render(<Icon name="lock" label="Locked" size={14} />).host.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Locked');
    expect(svg?.hasAttribute('aria-hidden')).toBe(false);
    expect(svg?.getAttribute('width')).toBe('14');
  });

  it('covers every icon the screens need', () => {
    for (const name of [
      'arrow-left',
      'chevron-down',
      'chevron-right',
      'copy',
      'pencil',
      'plus',
      'sun',
      'moon',
      'sliders',
      'lock',
      'book',
      'search',
      'check',
      'x',
      'alert-circle',
      'external-link',
      'link',
      'eye',
      'eye-off',
      'clipboard',
      'grid',
      'key',
      'send',
      'receive',
      'swap',
      'order',
      'star',
      'star-filled',
      'shield',
    ]) {
      expect(ICON_NAMES).toContain(name);
    }
  });
});

describe('Logo', () => {
  it('gives every instance its own gradient ids', () => {
    const { host } = render(
      <>
        <Logo variant="lockup" />
        <Logo variant="mark" />
      </>,
    );
    const ids = [...host.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const svg of host.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    expect(host.querySelectorAll('.bp-logo-word')).toHaveLength(1);
  });

  it('uses the kit gradient and a name when asked', () => {
    const svg = render(<Logo tint="kit" label="BeePocket" />).host.querySelector('svg');
    expect(svg?.getAttribute('aria-label')).toBe('BeePocket');
    expect(svg?.querySelector('stop')?.getAttribute('stop-color')).toBe('var(--bp-primary)');
  });
});

describe('Button', () => {
  it('renders the canvas variants', () => {
    const { host } = render(
      <>
        <Button size="lg">Create</Button>
        <Button variant="secondary">Import</Button>
        <Button variant="ghost" tone="muted" trailingIcon="chevron-down">
          Show 1 empty address
        </Button>
        <Button variant="chip">MAX</Button>
        <Button variant="icon" icon="plus" round label="Add address" />
      </>,
    );
    const [primary, secondary, ghost, chip, icon] = [...host.querySelectorAll('button')];
    expect(primary?.className).toBe('bp-btn bp-btn-primary bp-btn-lg');
    expect(secondary?.className).toBe('bp-btn bp-btn-secondary');
    expect(ghost?.className).toBe('bp-btn bp-btn-ghost bp-tone-muted');
    expect(ghost?.querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    expect(chip?.className).toBe('bp-btn bp-btn-chip');
    expect(icon?.getAttribute('aria-label')).toBe('Add address');
    expect(icon?.querySelector('.bp-btn-disc [data-icon="plus"]')).not.toBeNull();
  });

  it('names every icon-only button, and a nameless one does not compile', () => {
    const b = render(<Button variant="icon" icon="copy" label="Copy address Main" />).host
      .firstElementChild;
    expect(b?.tagName).toBe('BUTTON');
    expect(b?.getAttribute('aria-label')).toBe('Copy address Main');
    expect(b?.textContent).toBe('');
    // @ts-expect-error: an icon-only button needs a label.
    const nameless = <Button variant="icon" icon="copy" />;
    expect(render(nameless).host.querySelector('button')?.hasAttribute('aria-label')).toBe(false);
  });

  it('renders a link that opens in a new tab', () => {
    const a = render(
      <Button variant="ghost" tone="link" href="https://explorer.getbze.com" icon="search">
        View on Explorer
      </Button>,
    ).host.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://explorer.getbze.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a?.className).toContain('bp-tone-link');
  });

  it('reports pressed and expanded state and takes a screen hook class', () => {
    const b = render(
      <Button variant="ghost" pressed expanded={false} class="bp-x">
        Go
      </Button>,
    ).host.querySelector('button');
    expect(b?.getAttribute('aria-pressed')).toBe('true');
    expect(b?.getAttribute('aria-expanded')).toBe('false');
    expect(b?.classList.contains('bp-x')).toBe(true);
  });
});

describe('AppearanceButton', () => {
  it('offers the other scheme and flips on a tap', () => {
    const onToggle = vi.fn();
    const dark = render(<AppearanceButton scheme="dark" onToggle={onToggle} />).host;
    const button = dark.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('Switch to light mode');
    expect(button?.querySelector('[data-icon="sun"]')).not.toBeNull();
    fireEvent(button, 'click');
    expect(onToggle).toHaveBeenCalledOnce();
    const light = render(<AppearanceButton scheme="light" onToggle={onToggle} size={18} />).host;
    expect(light.querySelector('button')?.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(light.querySelector('[data-icon="moon"]')?.getAttribute('width')).toBe('18');
  });
});

describe('headers', () => {
  it('ScreenHeader: ← labelled Back, the title and a right slot', () => {
    const onBack = vi.fn();
    const { host } = render(
      <ScreenHeader title="Send BZE" onBack={onBack} right={<span id="r">B</span>} />,
    );
    const back = host.querySelector('button');
    expect(back?.getAttribute('aria-label')).toBe('Back');
    expect(back?.querySelector('[data-icon="arrow-left"]')).not.toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('Send BZE');
    expect(host.querySelector('#r')).not.toBeNull();
    fireEvent(back, 'click');
    expect(onBack).toHaveBeenCalledOnce();
    const custom = render(
      <ScreenHeader title="Sites" onBack={onBack} backLabel="Back to settings" />,
    );
    expect(custom.host.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Back to settings',
    );
  });

  it('OnboardingHeader: filled progress segments and the step count', () => {
    const { host } = render(
      <OnboardingHeader step={1} total={4} onBack={() => undefined} trailing={<i id="t" />} />,
    );
    const bars = host.querySelector('[role="img"]');
    expect(bars?.getAttribute('aria-label')).toBe('Step 2 of 4');
    expect(bars?.querySelectorAll('span')).toHaveLength(4);
    expect(bars?.querySelectorAll('.bp-progress-on')).toHaveLength(2);
    expect(host.textContent).toContain('2 of 4');
    expect(host.querySelector('#t')).not.toBeNull();
    const first = render(<OnboardingHeader step={0} total={3} />).host;
    expect(first.querySelector('button')).toBeNull();
  });

  it('HomeHeader with the token pill, the token title and the settings button', () => {
    const onPick = vi.fn();
    const onSettings = vi.fn();
    const { host } = render(
      <HomeHeader
        token={
          <TokenPill
            symbol="BZE"
            color="#33C3E0"
            label="Switch token, current BZE"
            onClick={onPick}
          />
        }
        actions={<SettingsButton onClick={onSettings} />}
      />,
    );
    const pill = host.querySelector<HTMLButtonElement>('.bp-token-pill');
    expect(pill?.getAttribute('aria-label')).toBe('Switch token, current BZE');
    expect(pill?.querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    fireEvent(pill, 'click');
    expect(onPick).toHaveBeenCalledOnce();
    const settings = host.querySelector('[aria-label="Settings"]');
    expect(settings?.querySelector('[data-icon="sliders"]')).not.toBeNull();
    fireEvent(settings, 'click');
    expect(onSettings).toHaveBeenCalledOnce();
    const single = render(<TokenTitle symbol="PAGE" caption="Page wallet" />).host;
    expect(single.textContent).toBe('PPAGEPage wallet');
  });
});

describe('Field', () => {
  it('links the label, shows a trailing adornment and a neutral hint', () => {
    const onInput = vi.fn();
    const { host } = render(
      <Field
        label="Amount"
        value=""
        size="amount"
        onInput={onInput}
        hint="Available 12 BZE"
        trailing={
          <>
            <FieldSuffix>BZE</FieldSuffix>
            <Button variant="chip">MAX</Button>
          </>
        }
      />,
    );
    const input = host.querySelector('input');
    expect(host.querySelector('label')?.getAttribute('for')).toBe(input?.id);
    expect(host.querySelector('.bp-field-box')?.textContent).toBe('BZEMAX');
    const hint = host.querySelector('.bp-field-note');
    expect(hint?.textContent).toBe('Available 12 BZE');
    expect(input?.getAttribute('aria-describedby')).toBe(hint?.id);
    expect(host.firstElementChild?.className).toBe('bp-field bp-field-amount');
    if (input) input.value = '1.5';
    fireEvent(input, 'input');
    expect(onInput).toHaveBeenCalledWith('1.5');
  });

  it('shows an error with the alert icon and a success with the check icon', () => {
    const bad = render(
      <Field label="To" value="x" mono onInput={() => undefined} error="Bad address" />,
    ).host;
    expect(bad.querySelector('[role="alert"]')?.textContent).toBe('Bad address');
    expect(bad.querySelector('[role="alert"] [data-icon="alert-circle"]')).not.toBeNull();
    expect(bad.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    expect(bad.firstElementChild?.classList.contains('bp-field-mono')).toBe(true);
    const good = render(
      <Field label="Repeat" value="x" onInput={() => undefined} success="Passwords match" />,
    ).host;
    expect(good.querySelector('.bp-field-success [data-icon="check"]')).not.toBeNull();
    expect(good.querySelector('[role="alert"]')).toBeNull();
  });

  it('hides the label visually but keeps it for screen readers', () => {
    const { host } = render(
      <Field
        label="Password"
        hideLabel
        placeholder="Password"
        value=""
        onInput={() => undefined}
      />,
    );
    expect(host.querySelector('label')?.className).toBe('bp-sr-only');
    expect(host.querySelector('input')?.placeholder).toBe('Password');
  });

  it('keeps its id across renders', () => {
    function Typing() {
      const [v, setV] = useState('');
      return <Field label="Name" value={v} onInput={setV} />;
    }
    const { host } = render(<Typing />);
    const input = host.querySelector('input');
    const id = input?.id;
    if (input) input.value = 'a';
    fireEvent(input, 'input');
    expect(host.querySelector('input')?.id).toBe(id);
  });
});

describe('WordGrid', () => {
  it('shows read-only numbered words', () => {
    const { host } = render(<WordGrid words={['ember', 'lunar', 'cotton']} />);
    const cells = host.querySelectorAll('li');
    expect(cells).toHaveLength(3);
    expect(cells[1]?.textContent).toBe('2lunar');
    expect(host.querySelector('input')).toBeNull();
    expect(cells[2]?.querySelector('[aria-label="Word 3"]')).not.toBeNull();
  });

  it('edits cells, marks invalid ones and hands a pasted phrase over', () => {
    const onWordInput = vi.fn();
    const onPaste = vi.fn();
    const { host } = render(
      <WordGrid
        words={['marble', 'gost', '']}
        invalid={[1]}
        onWordInput={onWordInput}
        onPaste={onPaste}
      />,
    );
    const inputs = host.querySelectorAll('input');
    expect(inputs).toHaveLength(3);
    expect(inputs[1]?.getAttribute('aria-label')).toBe('Word 2');
    expect(inputs[1]?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelectorAll('.bp-word-bad')).toHaveLength(1);
    const third = inputs[2];
    if (third) third.value = 'tribe';
    fireEvent(third, 'input');
    expect(onWordInput).toHaveBeenCalledWith(2, 'tribe');
    fireEvent(inputs[0], 'paste', { clipboardData: { getData: () => 'one two three' } });
    expect(onPaste).toHaveBeenCalledWith('one two three', 0);
    fireEvent(inputs[0], 'paste', { clipboardData: { getData: () => 'single' } });
    expect(onPaste).toHaveBeenCalledOnce();
  });
});

describe('Card and rows', () => {
  it('Card variants and detail rows', () => {
    const { host } = render(
      <Card variant="plain" rows>
        <DetailRow label="From">Main</DetailRow>
        <DetailRow label="Total" strong>
          1.5 BZE
        </DetailRow>
      </Card>,
    );
    expect(host.firstElementChild?.className).toBe('bp-card bp-card-plain bp-card-rows');
    expect(host.querySelectorAll('.bp-detail')).toHaveLength(2);
    expect(host.querySelector('.bp-detail-strong')?.textContent).toBe('Total1.5 BZE');
    expect(render(<Card variant="edge">x</Card>).host.firstElementChild?.className).toBe(
      'bp-card bp-card-edge',
    );
  });

  it('ListRow as one button with its own pencil and copy buttons', () => {
    const onClick = vi.fn();
    const onRename = vi.fn();
    const { host } = render(
      <ListRow
        title="Main"
        subtitle="bze1q8t…4kf"
        value="1,250.50"
        unit="BZE"
        chevron
        label="Send BZE from Main"
        onClick={onClick}
        titleAction={<Button variant="icon" icon="pencil" label="Rename Main" onClick={onRename} />}
        subtitleAction={<Button variant="icon" icon="copy" label="Copy address Main" />}
      />,
    );
    const hit = host.querySelector('.bp-list-row-hit');
    expect(hit?.getAttribute('aria-label')).toBe('Send BZE from Main');
    fireEvent(hit, 'click');
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent(host.querySelector('[aria-label="Rename Main"]'), 'click');
    expect(onRename).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-label="Copy address Main"]')).not.toBeNull();
    expect(host.querySelector('.bp-list-row-sub')?.classList.contains('bp-mono')).toBe(true);
    expect(host.querySelector('.bp-list-row-end [data-icon="chevron-right"]')).not.toBeNull();
    expect(host.querySelector('.bp-list-row-value')?.textContent).toBe('1,250.50BZE');
  });

  it('ListRow static, selected, disabled and dimmed', () => {
    const { host } = render(
      <ListRow
        title="Savings"
        subtitle="BeeZee"
        plainSubtitle
        value="0"
        valueMuted
        size="option"
        selected
        disabled
        onClick={() => undefined}
        leading={<Avatar label="Savings" kind="contact" />}
      />,
    );
    const row = host.firstElementChild;
    expect(row?.className).toBe('bp-list-row bp-list-row-option bp-list-row-on bp-list-row-off');
    const hit = host.querySelector('button');
    expect(hit?.getAttribute('aria-pressed')).toBe('true');
    expect(hit?.disabled).toBe(true);
    expect(host.querySelector('.bp-list-row-amount')?.classList.contains('bp-muted')).toBe(true);
    expect(host.querySelector('.bp-list-row-sub')?.classList.contains('bp-mono')).toBe(false);
    expect(render(<ListRow title="Static" />).host.querySelector('button')).toBeNull();
  });
});

describe('Avatar and IconTile', () => {
  it('shows the first letter on the token colour, and rejects a bad colour', () => {
    const good = render(<Avatar label="page" color="#FB923C" size={30} />).host.firstElementChild;
    expect(good?.textContent).toBe('P');
    expect((good as HTMLElement).style.background).toBe('rgb(251, 146, 60)');
    expect((good as HTMLElement).style.width).toBe('30px');
    expect(good?.getAttribute('aria-hidden')).toBe('true');
    const bad = render(<Avatar label="x" color="url(evil)" />).host.firstElementChild;
    expect((bad as HTMLElement).style.background).toBe('var(--bp-primary)');
  });

  it('tints contacts with the kit and shows a logo when given', () => {
    const contact = render(<Avatar label="Alex" kind="contact" />).host.firstElementChild;
    expect(contact?.className).toBe('bp-avatar bp-avatar-contact');
    expect((contact as HTMLElement).style.background).toBe('');
    const logo = render(<Avatar label="BZE" src="logo.png" />).host;
    expect(logo.querySelector('img')?.getAttribute('src')).toBe('logo.png');
    expect(render(<Avatar label=" " />).host.textContent).toBe('?');
  });

  it('falls back to the letter when the logo fails to load, and tries a new logo again', () => {
    function Swap() {
      const [src, setSrc] = useState('https://raw.githubusercontent.com/x/vdl.png');
      return (
        <>
          <Avatar label="vdl" src={src} />
          <button
            type="button"
            onClick={() => {
              setSrc('https://raw.githubusercontent.com/x/vdl2.png');
            }}
          />
        </>
      );
    }
    const { host } = render(<Swap />);
    fireEvent(host.querySelector('img'), 'error');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.bp-avatar')?.textContent).toBe('V');
    fireEvent(host.querySelector('button'), 'click');
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'https://raw.githubusercontent.com/x/vdl2.png',
    );
  });

  it('shows the letter for a null logo', () => {
    const { host } = render(<Avatar label="vdl" src={null} />);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('V');
  });

  it('IconTile sizes its icon and radius', () => {
    const tile = render(<IconTile icon="link" tone="inset" size={52} />).host.firstElementChild;
    expect(tile?.className).toBe('bp-icon-tile bp-icon-tile-inset');
    expect((tile as HTMLElement).style.borderRadius).toBe('16px');
    expect(tile?.querySelector('svg')?.getAttribute('width')).toBe('26');
  });
});

describe('Segmented', () => {
  function Tabs(props: { kind?: 'tabs' | 'radio' }) {
    const [v, setV] = useState<'a' | 'b'>('a');
    return (
      <Segmented
        label="Wallet view"
        kind={props.kind}
        value={v}
        onChange={setV}
        options={[
          { value: 'a', label: 'Addresses', count: 4 },
          { value: 'b', label: 'Activity' },
        ]}
      />
    );
  }

  it('is a tablist with a count and switches on a tap', () => {
    const { host } = render(<Tabs />);
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Wallet view');
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.textContent).toBe('Addresses4');
    fireEvent(tabs[1], 'click');
    expect(host.querySelectorAll('[role="tab"]')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('is a radiogroup when it picks a value, and arrow keys move', () => {
    const { host } = render(<Tabs kind="radio" />);
    const group = host.querySelector('[role="radiogroup"]');
    expect(host.querySelectorAll('[role="radio"]')[0]?.getAttribute('aria-checked')).toBe('true');
    fireEvent(group, 'keydown', { key: 'ArrowRight' });
    expect(host.querySelectorAll('[role="radio"]')[1]?.getAttribute('aria-checked')).toBe('true');
    fireEvent(group, 'keydown', { key: 'ArrowRight' });
    expect(host.querySelectorAll('[role="radio"]')[0]?.getAttribute('aria-checked')).toBe('true');
    fireEvent(group, 'keydown', { key: 'ArrowLeft' });
    expect(host.querySelectorAll('[role="radio"]')[1]?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('Toggle, Check, RadioCardGroup', () => {
  it('Toggle is a switch', () => {
    const onChange = vi.fn();
    const { host } = render(
      <Toggle checked={false} onChange={onChange} title="Theme follows token" description="Kits" />,
    );
    const sw = host.querySelector('[role="switch"]');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    expect(sw?.textContent).toBe('Theme follows tokenKits');
    fireEvent(sw, 'click');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Check is a checkbox with its label', () => {
    const onChange = vi.fn();
    const { host } = render(
      <Check checked onChange={onChange}>
        I've written it down
      </Check>,
    );
    const box = host.querySelector('[role="checkbox"]');
    expect(box?.getAttribute('aria-checked')).toBe('true');
    expect(box?.querySelector('[data-icon="check"]')).not.toBeNull();
    fireEvent(box, 'click');
    expect(onChange).toHaveBeenCalledWith(false);
    const off = render(
      <Check checked={false} onChange={onChange}>
        x
      </Check>,
    ).host;
    expect(off.querySelector('[data-icon="check"]')).toBeNull();
  });

  function Start(props: { onChange?: (v: string) => void }) {
    const [v, setV] = useState<'code' | 'manual' | 'later' | null>(null);
    return (
      <RadioCardGroup
        label="How do you want to start?"
        value={v}
        onChange={(next) => {
          props.onChange?.(next);
          setV(next);
        }}
        options={[
          {
            value: 'code',
            title: 'I have a token code',
            subtitle: 'One step',
            icon: 'ticket',
            body: <input aria-label="Token code" />,
          },
          { value: 'manual', title: "I'll choose my tokens", icon: 'grid', iconTone: 'inset' },
          { value: 'later', title: 'Later', icon: 'x' },
        ]}
      />
    );
  }
  const radios = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
  const checked = (host: HTMLElement) =>
    radios(host).map((r) => r.getAttribute('aria-checked') === 'true');
  const tabbable = (host: HTMLElement) => radios(host).map((r) => r.tabIndex === 0);

  it('RadioCardGroup is a named radiogroup; a tap picks a card and opens its body', () => {
    const onChange = vi.fn();
    const { host } = render(<Start onChange={onChange} />);
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
      'How do you want to start?',
    );
    expect(checked(host)).toEqual([false, false, false]);
    // Before any pick only the first card is in the Tab order.
    expect(tabbable(host)).toEqual([true, false, false]);
    expect(host.querySelector('input')).toBeNull();
    fireEvent(radios(host)[0], 'click');
    expect(onChange).toHaveBeenCalledWith('code');
    expect(checked(host)).toEqual([true, false, false]);
    expect(host.querySelector('[aria-label="Token code"]')).not.toBeNull();
    expect(host.querySelector('.bp-radio-card-on .bp-radio-on')).not.toBeNull();
  });

  it('RadioCardGroup moves the pick and the Tab stop with the arrow keys', async () => {
    const { host } = render(<Start />);
    const group = host.querySelector('[role="radiogroup"]');
    fireEvent(group, 'keydown', { key: 'ArrowDown' });
    expect(checked(host)).toEqual([true, false, false]);
    fireEvent(group, 'keydown', { key: 'ArrowDown' });
    expect(checked(host)).toEqual([false, true, false]);
    expect(tabbable(host)).toEqual([false, true, false]);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(radios(host)[1]);
    fireEvent(group, 'keydown', { key: 'ArrowUp' });
    fireEvent(group, 'keydown', { key: 'ArrowUp' });
    expect(checked(host)).toEqual([false, false, true]);
    fireEvent(group, 'keydown', { key: 'Home' });
    expect(checked(host)).toEqual([true, false, false]);
    fireEvent(group, 'keydown', { key: 'End' });
    expect(checked(host)).toEqual([false, false, true]);
    fireEvent(group, 'keydown', { key: 'a' });
    expect(checked(host)).toEqual([false, false, true]);
  });
});

describe('Sheet layout', () => {
  it('has a handle, a title row with count and close, a body and sticky actions', () => {
    const onClose = vi.fn();
    const { host } = render(
      <Sheet
        open
        title="Connected sites"
        count={3}
        closeButton
        onClose={onClose}
        height="tall"
        actions={<Button>Save</Button>}
      >
        <p>body</p>
      </Sheet>,
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.className).toBe('bp-sheet bp-sheet-tall');
    expect(dialog?.querySelector('.bp-sheet-handle')).not.toBeNull();
    expect(dialog?.querySelector('h2')?.textContent).toBe('Connected sites');
    expect(dialog?.querySelector('.bp-sheet-count')?.textContent).toBe('3');
    expect(dialog?.querySelector('.bp-sheet-body')?.textContent).toBe('body');
    expect(dialog?.querySelector('.bp-sheet-actions')?.textContent).toBe('Save');
    fireEvent(dialog?.querySelector('[aria-label="Close"]'), 'click');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('DropdownSheet', () => {
  function Filter() {
    const [v, setV] = useState<'all' | 'main'>('all');
    return (
      <DropdownSheet
        title="Filter by address"
        value={v}
        onChange={setV}
        options={[
          { value: 'all', label: 'All addresses' },
          { value: 'main', label: 'Main', sub: 'bze1…4kf' },
        ]}
      />
    );
  }

  it('opens a single-choice sheet from a chip and closes on a pick', () => {
    const { host } = render(<Filter />);
    const chip = host.querySelector<HTMLButtonElement>('.bp-dropdown');
    expect(chip?.textContent).toBe('All addresses');
    expect(chip?.getAttribute('aria-label')).toBe('Filter by address, now All addresses');
    expect(chip?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('select')).toBeNull();
    fireEvent(chip, 'click');
    const radios = host.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]?.querySelector('.bp-mono')?.textContent).toBe('bze1…4kf');
    fireEvent(radios[1], 'click');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.bp-dropdown')?.textContent).toBe('Main');
  });
});

describe('states', () => {
  it('EmptyState: tile, title, sub', () => {
    const { host } = render(
      <EmptyState icon="link" title="No connected sites" sub="They show up here." />,
    );
    expect(host.querySelector('.bp-icon-tile-soft')).not.toBeNull();
    expect(host.querySelector('.bp-empty-title')?.textContent).toBe('No connected sites');
    expect(host.querySelector('.bp-empty-sub')?.textContent).toBe('They show up here.');
    const quiet = render(<EmptyState icon="activity" title="Nothing" tone="inset" />).host;
    expect(quiet.querySelector('.bp-icon-tile-inset')).not.toBeNull();
    expect(quiet.querySelector('.bp-empty-sub')).toBeNull();
  });

  it.each([
    ['ok', 'check'],
    ['bad', 'x'],
  ] as const)('ResultLayout %s shows its disc, details, link and actions', (status, icon) => {
    const { host } = render(
      <ResultLayout
        status={status}
        title="Sent"
        sub="1.5 BZE to Alex"
        link={
          <Button variant="ghost" tone="link" href="https://explorer.getbze.com">
            View
          </Button>
        }
        actions={<Button>Done</Button>}
      >
        <Card rows>
          <DetailRow label="From">Main</DetailRow>
        </Card>
      </ResultLayout>,
    );
    expect(host.firstElementChild?.className).toBe(`bp-result bp-result-${status}`);
    expect(host.querySelector(`.bp-result-disc [data-icon="${icon}"]`)).not.toBeNull();
    expect(host.querySelector('h1')?.textContent).toBe('Sent');
    expect(host.querySelector('.bp-result-link a')).not.toBeNull();
    const done = byText(host, 'Done');
    expect(done?.tagName).toBe('BUTTON');
    expect(done?.closest('.bp-bottom')).not.toBeNull();
    expect(host.querySelector('.bp-detail')?.textContent).toBe('FromMain');
  });

  it('ResultLayout pending shows a named ring', () => {
    const { host } = render(
      <ResultLayout status="pending" title="Sending" pendingLabel="Sending 1.5 BZE" />,
    );
    expect(host.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe(
      'Sending 1.5 BZE',
    );
    expect(host.querySelector('.bp-result-disc')).toBeNull();
  });

  it('Toast announces politely at its offset', () => {
    const toast = render(<Toast message="Address copied" bottom={76} />).host.firstElementChild;
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.textContent).toBe('Address copied');
    expect((toast as HTMLElement).style.bottom).toBe('76px');
  });

  it('BottomActions stacks its buttons', () => {
    const { host } = render(
      <BottomActions>
        <Button>Confirm</Button>
        <Button variant="secondary">Edit</Button>
      </BottomActions>,
    );
    expect(host.firstElementChild?.className).toBe('bp-bottom');
    expect(host.querySelectorAll('button')).toHaveLength(2);
  });
});
