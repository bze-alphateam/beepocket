import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'preact/hooks';
import { cleanup, fireEvent, render } from './test-render';
import {
  BottomActions,
  Button,
  Check,
  CheckList,
  DappHeader,
  DetailCard,
  GhostRow,
  MessageCard,
  RadioList,
  RequestHero,
  RiskBox,
  SelectRow,
  SiteCard,
} from '.';

afterEach(cleanup);

describe('DappHeader', () => {
  it('shows the mark, the title as the heading and the chain pill', () => {
    const { host } = render(<DappHeader title="Approve transaction" chainId="beezee-1" />);
    expect(host.querySelector('h1')?.textContent).toBe('Approve transaction');
    expect(host.querySelector('.bp-dapp-header svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.bp-chain-pill')?.textContent).toBe('beezee-1');
    expect(host.querySelector('.bp-chain-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.bp-dapp-header-badge')).toBeNull();
  });

  it('shows a badge with its own accessible name', () => {
    const { host } = render(
      <DappHeader
        title="Approve transaction"
        chainId="bzetestnet-3"
        badge={{ text: '1 of 3', label: 'Request 1 of 3' }}
      />,
    );
    const badge = host.querySelector('.bp-dapp-header-badge');
    expect(badge?.textContent).toBe('1 of 3');
    expect(badge?.getAttribute('aria-label')).toBe('Request 1 of 3');
    expect(host.querySelector('.bp-chain-pill')?.textContent).toBe('bzetestnet-3');
  });
});

describe('SiteCard', () => {
  it('names the site by its host and shows the full origin after the lock', () => {
    const { host } = render(<SiteCard origin="https://dex.getbze.com" size="lg" />);
    expect(host.querySelector('.bp-site-card-lg')).not.toBeNull();
    expect(host.querySelector('.bp-site-card-name')?.textContent).toBe('dex.getbze.com');
    expect(host.querySelector('.bp-site-card-origin')?.textContent).toBe('https://dex.getbze.com');
    expect(host.querySelector('.bp-avatar-site')?.textContent).toBe('D');
    expect(host.querySelector('.bp-site-card-aside')).toBeNull();
  });

  it('keeps a port in the origin and renders the right column', () => {
    const { host } = render(
      <SiteCard
        origin="http://localhost:4173"
        aside={
          <>
            Signs with <strong>Main</strong>
          </>
        }
      />,
    );
    expect(host.querySelector('.bp-site-card-sm')).not.toBeNull();
    expect(host.querySelector('.bp-site-card-name')?.textContent).toBe('localhost');
    expect(host.querySelector('.bp-site-card-origin')?.textContent).toBe('http://localhost:4173');
    expect(host.querySelector('.bp-site-card-aside')?.textContent).toBe('Signs with Main');
  });

  it('shows an origin that does not parse as it is', () => {
    const { host } = render(<SiteCard origin="not a url" />);
    expect(host.querySelector('.bp-site-card-name')?.textContent).toBe('not a url');
  });
});

describe('CheckList', () => {
  it('lists every line with a tick', () => {
    const { host } = render(<CheckList items={['Sees this address', 'Asks before signing']} />);
    const items = host.querySelectorAll('.bp-check-list li');
    expect([...items].map((li) => li.textContent)).toEqual([
      'Sees this address',
      'Asks before signing',
    ]);
    expect(items[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('RiskBox', () => {
  it('red: an alert with its title, text and the tick', () => {
    const onChange = vi.fn();
    const { host } = render(
      <RiskBox
        tone="red"
        title="This address could empty Main"
        action={
          <Check checked={false} onChange={onChange}>
            I trust this address
          </Check>
        }
      >
        It could send any token.
      </RiskBox>,
    );
    const box = host.querySelector('[role="alert"]');
    expect(box?.classList.contains('bp-risk-red')).toBe(true);
    expect(box?.querySelector('.bp-risk-title')?.textContent).toBe('This address could empty Main');
    expect(box?.querySelector('.bp-risk-text')?.textContent).toBe('It could send any token.');
    fireEvent(box?.querySelector('[role="checkbox"]'), 'click');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('amber: one note line, never an alert', () => {
    const { host } = render(<RiskBox tone="amber">First time on this site.</RiskBox>);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    const note = host.querySelector('[role="note"]');
    expect(note?.classList.contains('bp-risk-amber')).toBe(true);
    expect(note?.textContent).toBe('First time on this site.');
  });
});

describe('BottomActions', () => {
  it('stacks by default and sits side by side as a row', () => {
    const { host } = render(
      <>
        <BottomActions>
          <Button>Next</Button>
        </BottomActions>
        <BottomActions row>
          <Button variant="secondary">Reject</Button>
          <Button>Approve</Button>
        </BottomActions>
      </>,
    );
    const [stack, row] = host.querySelectorAll('.bp-bottom');
    expect(stack?.classList.contains('bp-bottom-row')).toBe(false);
    expect(row?.classList.contains('bp-bottom-row')).toBe(true);
    expect([...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Reject',
      'Approve',
    ]);
  });
});

describe('DetailCard', () => {
  it('renders the rows, monospace ones in the mono face, and the footer last', () => {
    const onClick = vi.fn();
    const { host } = render(
      <DetailCard
        rows={[
          ['Market', 'BZE/USDC'],
          ['Given to', 'bze1k9f3…w7xq2a', 'mono'],
        ]}
        footer={<SelectRow tone="quiet" caption="Network fee" label="Fee" onClick={onClick} />}
      />,
    );
    const rows = host.querySelectorAll('.bp-detail');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.bp-detail-label')?.textContent).toBe('Market');
    expect(rows[0]?.querySelector('.bp-mono')).toBeNull();
    expect(rows[1]?.querySelector('.bp-detail-value .bp-mono')?.textContent).toBe(
      'bze1k9f3…w7xq2a',
    );
    const footer = host.querySelector('.bp-detail-card > :last-child');
    expect(footer?.classList.contains('bp-detail-card-footer')).toBe(true);
    fireEvent(footer?.querySelector('button'), 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders no footer without one', () => {
    const { host } = render(<DetailCard rows={[['Memo', 'hi']]} />);
    expect(host.querySelector('.bp-detail-card-footer')).toBeNull();
  });
});

describe('RequestHero', () => {
  it('shows the kind, the big line and the sub line', () => {
    const { host } = render(
      <RequestHero icon="swap" kind="Swap" hero="1,000.00 BZE" sub="for at least 318.20 USDC" />,
    );
    expect(host.querySelector('.bp-req-hero-kind')?.textContent).toBe('Swap');
    expect(host.querySelector('.bp-req-hero-accent')).not.toBeNull();
    expect(host.querySelector('.bp-req-hero-big')?.textContent).toBe('1,000.00 BZE');
    expect(host.querySelector('.bp-req-hero-sub')?.textContent).toBe('for at least 318.20 USDC');
  });

  it('turns the disc red for a dangerous request and drops an empty sub line', () => {
    const { host } = render(
      <RequestHero icon="grant" kind="Give permission" hero="Spend" sub="" tone="bad" />,
    );
    expect(host.querySelector('.bp-req-hero-bad')).not.toBeNull();
    expect(host.querySelector('.bp-req-hero-sub')).toBeNull();
  });
});

describe('GhostRow', () => {
  it('is one button named by its title, with the hint and a chevron', () => {
    const onClick = vi.fn();
    const { host } = render(
      <GhostRow icon="code" title="Message details" hint="MsgMultiSwap" onClick={onClick} />,
    );
    const button = host.querySelector('button');
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button?.querySelector('.bp-ghost-row-title')?.textContent).toBe('Message details');
    expect(button?.querySelector('.bp-ghost-row-hint')?.textContent).toBe('MsgMultiSwap');
    fireEvent(button, 'click');
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('MessageCard', () => {
  it('is a list item with its icon, title, line, position and body', () => {
    const { host } = render(
      <ol>
        <MessageCard
          icon="order"
          title="Sell order"
          line="500.00 BZE at 0.3350 USDC"
          position="2 of 2"
          tone="warn"
          class="hook"
        >
          <pre>raw</pre>
        </MessageCard>
      </ol>,
    );
    const li = host.querySelector('li');
    expect(li?.classList.contains('bp-msg-card-warn')).toBe(true);
    expect(li?.classList.contains('hook')).toBe(true);
    expect(li?.querySelector('strong')?.textContent).toBe('Sell order');
    expect(li?.querySelector('.bp-msg-card-text span')?.textContent).toBe(
      '500.00 BZE at 0.3350 USDC',
    );
    expect(li?.querySelector('.bp-msg-card-pos')?.textContent).toBe('2 of 2');
    expect(li?.querySelector('pre')?.textContent).toBe('raw');
  });
});

describe('RadioList', () => {
  function Picker(props: { onChange?: (v: number) => void; disabled?: boolean }) {
    const [value, setValue] = useState(0);
    return (
      <RadioList
        label="Address to connect"
        value={value}
        disabled={props.disabled}
        onChange={(v) => {
          setValue(v);
          props.onChange?.(v);
        }}
        options={[
          { value: 0, title: 'Main', subtitle: 'bze1q8…4kf', amount: '8,240.10 BZE' },
          { value: 3, title: 'Cold', subtitle: 'bze1z4…8wy', amount: '0 BZE', muted: true },
        ]}
      />
    );
  }

  it('is a named radio group with one checked, focusable row', () => {
    const { host } = render(<Picker />);
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
      'Address to connect',
    );
    const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1]);
    expect(radios[0]?.classList.contains('bp-radio-row-on')).toBe(true);
    expect(radios[1]?.querySelector('.bp-radio-row-value')?.classList.contains('bp-muted')).toBe(
      true,
    );
    expect(radios[0]?.textContent).toBe('Mainbze1q8…4kf8,240.10 BZE');
  });

  it('picks by tap and by arrow keys', () => {
    const onChange = vi.fn();
    const { host } = render(<Picker onChange={onChange} />);
    fireEvent(host.querySelectorAll('[role="radio"]')[1], 'click');
    expect(onChange).toHaveBeenLastCalledWith(3);
    expect(host.querySelectorAll('[role="radio"]')[1]?.getAttribute('aria-checked')).toBe('true');
    fireEvent(host.querySelector('[role="radiogroup"]'), 'keydown', { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('ignores taps and keys while disabled', () => {
    const onChange = vi.fn();
    const { host } = render(<Picker onChange={onChange} disabled />);
    fireEvent(host.querySelectorAll('[role="radio"]')[1], 'click');
    fireEvent(host.querySelector('[role="radiogroup"]'), 'keydown', { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
