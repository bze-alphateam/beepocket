import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from './test-render';
import { CopyButton, ListGroup, ListRow, SearchField, SectionLabel, StarButton } from '.';

afterEach(cleanup);

describe('SearchField', () => {
  it('names the input by its hidden label, shows the icon and the placeholder', () => {
    const onInput = vi.fn();
    const { host } = render(
      <SearchField
        label="Search tokens"
        value=""
        placeholder="Search name or symbol"
        onInput={onInput}
      />,
    );
    const input = host.querySelector('input');
    const label = host.querySelector('label');
    expect(label?.textContent).toBe('Search tokens');
    expect(label?.className).toBe('bp-sr-only');
    expect(label?.htmlFor).toBe(input?.id);
    expect(input?.placeholder).toBe('Search name or symbol');
    expect(host.querySelector('.bp-search svg')).not.toBeNull();
    if (!input) throw new Error('no input');
    input.value = 'os';
    fireEvent(input, 'input');
    expect(onInput).toHaveBeenCalledWith('os');
  });

  it('gives every instance its own id', () => {
    const { host } = render(
      <>
        <SearchField label="A" value="" onInput={() => undefined} />
        <SearchField label="B" value="" onInput={() => undefined} />
      </>,
    );
    const [a, b] = [...host.querySelectorAll('input')];
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('SectionLabel', () => {
  it('is a heading with the title and the count after a middle dot', () => {
    const { host } = render(<SectionLabel title="Preferred" count={4} />);
    const h = host.querySelector('h3');
    expect(h?.className).toBe('bp-section-label');
    expect(h?.textContent).toBe('Preferred · 4');
  });

  it('leaves the count out when absent and takes a level', () => {
    const { host } = render(<SectionLabel title="Results" level={4} />);
    expect(host.querySelector('h4')?.textContent).toBe('Results');
  });
});

describe('StarButton', () => {
  it('is a named toggle: filled and pressed when on, outline when off', () => {
    const onToggle = vi.fn();
    const { host } = render(
      <>
        <StarButton on label="Remove BZE from preferred" onToggle={onToggle} />
        <StarButton on={false} label="Add VDL to preferred" onToggle={onToggle} />
      </>,
    );
    const [on, off] = [...host.querySelectorAll('button')];
    expect(on?.getAttribute('aria-label')).toBe('Remove BZE from preferred');
    expect(on?.getAttribute('aria-pressed')).toBe('true');
    expect(on?.classList.contains('bp-star-on')).toBe(true);
    expect(on?.querySelector('[fill="currentColor"]')).not.toBeNull();
    expect(off?.getAttribute('aria-pressed')).toBe('false');
    expect(off?.classList.contains('bp-star-on')).toBe(false);
    fireEvent(off, 'click');
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const onToggle = vi.fn();
    const { host } = render(
      <StarButton on disabled label="Keep at least one preferred token" onToggle={onToggle} />,
    );
    const b = host.querySelector('button');
    expect(b?.disabled).toBe(true);
    fireEvent(b, 'click');
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('CopyButton', () => {
  it('is a named copy icon that turns into a check once copied', () => {
    const onCopy = vi.fn();
    const { host } = render(
      <>
        <CopyButton label="Copy address Main" onCopy={onCopy} />
        <CopyButton label="Copy address Savings" copied onCopy={onCopy} />
      </>,
    );
    const [idle, done] = [...host.querySelectorAll('button')];
    expect(idle?.getAttribute('aria-label')).toBe('Copy address Main');
    expect(idle?.classList.contains('bp-copy-done')).toBe(false);
    expect(done?.classList.contains('bp-copy-done')).toBe(true);
    expect(idle?.innerHTML).not.toBe(done?.innerHTML);
    fireEvent(idle, 'click');
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});

describe('ListGroup', () => {
  it('titles its rows and marks a flat group', () => {
    const { host } = render(
      <>
        <ListGroup title="Preferred" count={2} flat>
          <ListRow size="option" title="BZE" />
          <ListRow size="option" title="PAGE" selected />
        </ListGroup>
        <ListGroup title="You hold">
          <ListRow size="option" title="VDL" />
        </ListGroup>
      </>,
    );
    const [flat, plain] = [...host.querySelectorAll('section')];
    expect(flat?.querySelector('h3')?.textContent).toBe('Preferred · 2');
    expect(flat?.className).toBe('bp-list-group bp-list-group-flat');
    expect(flat?.querySelectorAll('.bp-list-row')).toHaveLength(2);
    expect(plain?.className).toBe('bp-list-group');
    expect(plain?.querySelector('h3')?.textContent).toBe('You hold');
  });
});
