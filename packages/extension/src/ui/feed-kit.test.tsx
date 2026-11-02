import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from './test-render';
import { FeedRow, FilterChip, Icon, Tag } from '.';

afterEach(cleanup);

describe('FeedRow', () => {
  it('is one named link to a new tab with icon disc, title, tag, sub line, value and caption', () => {
    const { host } = render(
      <FeedRow
        href="https://explorer.example/txs/A"
        label="Send −250 BZE, Main to Alex. Opens on Explorer"
        icon="send"
        title="Send"
        tag={<Tag>Open</Tag>}
        sub="Main → Alex"
        value="−250.00"
        caption="14:32 · 31 Oct"
      />,
    );
    const links = host.querySelectorAll('a');
    expect(links).toHaveLength(1);
    const row = links[0];
    expect(row?.getAttribute('href')).toBe('https://explorer.example/txs/A');
    expect(row?.getAttribute('target')).toBe('_blank');
    expect(row?.getAttribute('rel')).toContain('noopener');
    expect(row?.getAttribute('aria-label')).toBe('Send −250 BZE, Main to Alex. Opens on Explorer');
    expect(row?.querySelector('.bp-icon-tile-soft [data-icon="send"]')).not.toBeNull();
    expect(row?.querySelector('.bp-icon-tile')?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.querySelector('.bp-feed-row-title')?.textContent).toBe('SendOpen');
    expect(row?.querySelector('.bp-feed-row-sub')?.textContent).toBe('Main → Alex');
    expect(row?.querySelector('.bp-feed-row-value')?.textContent).toBe('−250.00');
    expect(row?.querySelector('.bp-feed-row-caption')?.textContent).toBe('14:32 · 31 Oct');
    expect(row?.hasAttribute('data-failed')).toBe(false);
  });

  it('takes a disc tone, a failed mark and a screen hook class, and leaves out empty parts', () => {
    const { host } = render(
      <FeedRow href="#" label="x" icon="dot" tone="bad" title="Swap" failed class="bp-hook" />,
    );
    const row = host.querySelector('a');
    expect(row?.className).toBe('bp-feed-row bp-hook');
    expect(row?.hasAttribute('data-failed')).toBe(true);
    expect(row?.querySelector('.bp-icon-tile-bad [data-icon="dot"]')).not.toBeNull();
    expect(row?.querySelector('.bp-feed-row-sub')).toBeNull();
    expect(row?.querySelector('.bp-feed-row-end')).toBeNull();
  });

  it('defaults to the soft disc and stacks several values', () => {
    const { host } = render(
      <FeedRow
        href="#"
        label="x"
        icon="swap"
        title="Swap"
        value={
          <>
            <span>−1</span>
            <span>+2</span>
          </>
        }
      />,
    );
    expect(host.querySelector('.bp-icon-tile-soft')).not.toBeNull();
    expect(host.querySelectorAll('.bp-feed-row-value > span')).toHaveLength(2);
    expect(host.querySelector('.bp-feed-row-caption')).toBeNull();
  });
});

describe('Tag', () => {
  it.each([
    [undefined, 'bp-tag bp-tag-accent'],
    ['accent', 'bp-tag bp-tag-accent'],
    ['bad', 'bp-tag bp-tag-bad'],
  ] as const)('tone %s draws %s', (tone, cls) => {
    const { host } = render(<Tag tone={tone}>Failed</Tag>);
    const tag = host.querySelector('span');
    expect(tag?.className).toBe(cls);
    expect(tag?.textContent).toBe('Failed');
  });
});

describe('FilterChip', () => {
  const options = [
    { value: 'all', label: 'All addresses', sub: '2 addresses' },
    { value: '0', label: 'Main', sub: 'bze1q8t5…y4x4kf' },
    { value: '1', label: 'Savings', sub: 'bze1v3n7…r5e9ta' },
  ];

  it('is outlined while it shows everything and names itself with the current value', () => {
    const { host } = render(
      <FilterChip
        title="Show activity for"
        label="Filter activity by address, now All addresses"
        options={options}
        value="all"
        all="all"
        onChange={() => undefined}
      />,
    );
    expect(host.querySelector('.bp-filter-chip')?.hasAttribute('data-on')).toBe(false);
    const trigger = host.querySelector('button.bp-dropdown');
    expect(trigger?.getAttribute('aria-label')).toBe(
      'Filter activity by address, now All addresses',
    );
    expect(trigger?.textContent).toBe('All addresses');
  });

  it('turns soft once it narrows the list, and reports a pick from its sheet', () => {
    const onChange = vi.fn();
    const { host } = render(
      <FilterChip
        title="Show activity for"
        options={options}
        value="1"
        all="all"
        onChange={onChange}
      />,
    );
    expect(host.querySelector('.bp-filter-chip')?.hasAttribute('data-on')).toBe(true);
    fireEvent(host.querySelector('button.bp-dropdown'), 'click');
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Show activity for');
    const picked = dialog?.querySelector('[role="radio"][aria-checked="true"]');
    expect(picked?.textContent).toContain('Savings');
    fireEvent(
      [...(dialog?.querySelectorAll('[role="radio"]') ?? [])].find((b) =>
        b.textContent.includes('Main'),
      ),
      'click',
    );
    expect(onChange).toHaveBeenCalledWith('0');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Icon dot', () => {
  it('is a filled circle', () => {
    const { host } = render(<Icon name="dot" />);
    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.querySelector('circle')).not.toBeNull();
  });
});
