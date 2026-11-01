import { render as preactRender } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../protocol/client';
import {
  fail,
  ok,
  type ActivityAmount,
  type ActivityItem,
  type ActivityPageResult,
  type ListedToken,
  type Method,
  type RequestOf,
  type Result,
  type TokenBalances,
  type WalletAddress,
} from '../../protocol';
import { applyTheme } from '../../theme';
import { ClientProvider } from '../../popup/client-context';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { ActivityTab } from './ActivityTab';

afterEach(cleanup);

const PAGE: ListedToken = {
  denom: 'factory/bze1x/page',
  symbol: 'PAGE',
  name: 'Page',
  decimals: 2,
  kind: 'factory',
  source: 'chain',
  branding: null,
};
const addr = (index: number, label: string): WalletAddress => ({
  index,
  label,
  address: `bze1address${String(index)}`,
});

const amt = (amount: string, over: Partial<ActivityAmount> = {}): ActivityAmount => ({
  denom: PAGE.denom,
  amount,
  symbol: 'PAGE',
  exponent: 2,
  ...over,
});

const item = (n: number, over: Partial<ActivityItem> = {}): ActivityItem => ({
  addressIndex: 0,
  addressLabel: 'Main',
  time: '2026-10-31T13:39:14Z',
  txHash: `TX${String(n)}`,
  kind: 'send',
  category: 'received',
  isSigner: false,
  success: true,
  counterparty: null,
  amounts: [amt('150')],
  feeOnly: false,
  ...over,
});

const reply = (over: Partial<ActivityPageResult>): Result<ActivityPageResult> =>
  ok({
    items: [],
    cursor: null,
    done: true,
    explorer: 'https://explorer.example/accounts/bze1a',
    ...over,
  });

function setup(
  pages: (req: RequestOf<'activity.page'>) => Result<ActivityPageResult>,
  addresses = [addr(0, 'Main')],
  balances: TokenBalances | null = null,
) {
  const calls: RequestOf<'activity.page'>[] = [];
  const client: Client = {
    call: vi.fn(<M extends Method>(method: M, req: RequestOf<M>) => {
      calls.push(req as RequestOf<'activity.page'>);
      return Promise.resolve(pages(req as RequestOf<'activity.page'>) as never);
    }),
  };
  const view = (b: TokenBalances | null) => (
    <ClientProvider client={client}>
      <ActivityTab token={PAGE} addresses={addresses} balances={b} />
    </ClientProvider>
  );
  const { host } = render(view(balances));
  const tick = async () => {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };
  return {
    host,
    calls,
    tick,
    update: (b: TokenBalances | null) => {
      void act(() => {
        preactRender(view(b), host);
      });
    },
  };
}

const click = (host: HTMLElement, label: string) => {
  fireEvent(
    [...host.querySelectorAll('button')].find((b) => b.textContent === label),
    'click',
  );
};

describe('ActivityTab', () => {
  it('shows rows with words, signed amounts, counterparty and the end state with the explorer link', async () => {
    const { host, tick, calls } = setup(() =>
      reply({
        items: [
          item(1, { amounts: [amt('150')], counterparty: 'Exchange' }),
          item(2, { kind: 'dex_swap', amounts: [amt('-2500')], success: false }),
          item(3, { kind: 'fee_only', amounts: [amt('-7')], feeOnly: true }),
          item(4, { kind: 'delegate', category: 'staking', amounts: [amt('-3')], feeOnly: true }),
        ],
      }),
    );
    await tick();
    expect(calls[0]).toEqual({});
    const rows = [...host.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows[0]).toContain('Received');
    expect(rows[0]).toContain('+1.5 PAGE');
    expect(rows[0]).toContain('with Exchange');
    expect(rows[1]).toContain('Failed: Swapped');
    expect(rows[1]).toContain('−25');
    expect(rows[2]).toContain('Network fee');
    expect(rows[2]).toContain('−0.07');
    expect(rows[3]).toContain('Network fee');
    expect(rows[3]).toContain('Staked');
    expect(rows[3]).toContain('−0.03');
    expect(host.textContent).toContain("That's everything from the last 30 days");
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      'https://explorer.example/accounts/bze1a',
    );
    expect(host.textContent).toContain('Older activity on Explorer');
  });

  it('shows every amount of a multi-token row, the largest first, with fallbacks for unknown tokens', async () => {
    const { host, tick } = setup(() =>
      reply({
        items: [
          item(1, {
            kind: 'dex_swap',
            amounts: [
              amt('-2000000', { denom: 'ubze', symbol: 'BZE', exponent: 6 }),
              amt('500'),
              amt('42', { denom: 'factory/bze1abc/zzz', symbol: null, exponent: null }),
            ],
          }),
          item(2, { kind: 'dex_swap', amounts: [] }),
        ],
      }),
    );
    await tick();
    const rows = [...host.querySelectorAll('li')];
    const first = rows[0]?.textContent ?? '';
    expect(first).toContain('−2 BZE');
    expect(first).toContain('+5 PAGE');
    expect(first).toContain('+42 factory/…/zzz');
    expect(first.indexOf('−2 BZE')).toBeLessThan(first.indexOf('+5 PAGE'));
    expect(rows[1]?.textContent).toContain('Swapped');
    expect(rows[1]?.textContent).not.toMatch(/\b0\b/);
  });

  it('loads 10 more on request and hides the button when done', async () => {
    const { host, tick, calls } = setup((req) =>
      req.cursor === undefined
        ? reply({ items: [item(1), item(2)], cursor: 'c1', done: false })
        : reply({ items: [item(3)] }),
    );
    await tick();
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.textContent).not.toContain("That's everything");
    click(host, 'Load more');
    await tick();
    expect(calls[1]).toEqual({ cursor: 'c1' });
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(host.textContent).not.toContain('Load more');
    expect(host.textContent).toContain("That's everything");
  });

  it('says so when there is nothing in 30 days', async () => {
    const { host, tick } = setup(() => reply({}));
    await tick();
    expect(host.textContent).toContain('No activity in the last 30 days');
    expect(host.querySelector('ul')).toBeNull();
  });

  it('shows a retryable error, never an empty list that looks final', async () => {
    let down = true;
    const { host, tick } = setup(() =>
      down ? fail('activity-unavailable', 'down') : reply({ items: [item(1)] }),
    );
    await tick();
    expect(host.textContent).toContain("Couldn't load activity");
    expect(host.textContent).not.toContain('No activity in the last 30 days');
    down = false;
    click(host, 'Retry');
    await tick();
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.textContent).not.toContain("Couldn't load activity");
  });

  it('keeps the rows and retries with the same cursor when loading more fails', async () => {
    let down = false;
    const { host, tick, calls } = setup((req) =>
      req.cursor === undefined
        ? reply({ items: [item(1)], cursor: 'c1', done: false })
        : down
          ? fail('activity-unavailable', 'down')
          : reply({ items: [item(2)] }),
    );
    await tick();
    down = true;
    click(host, 'Load more');
    await tick();
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.textContent).toContain("Couldn't load activity");
    down = false;
    click(host, 'Retry');
    await tick();
    expect(calls.at(-1)).toEqual({ cursor: 'c1' });
    expect(host.querySelectorAll('li')).toHaveLength(2);
  });

  it('filters by address and labels rows when several addresses are merged', async () => {
    const { host, tick, calls } = setup(
      (req) =>
        reply({
          items: [item(1, { addressIndex: req.addressIndex ?? 1, addressLabel: 'Savings' })],
        }),
      [addr(0, 'Main'), addr(1, 'Savings')],
    );
    await tick();
    expect(host.querySelector('li')?.textContent).toContain('Savings');
    const select = host.querySelector('select');
    if (!select) throw new Error('no address filter');
    select.value = '0';
    fireEvent(select, 'change');
    await tick();
    expect(calls.at(-1)).toEqual({ addressIndex: 0 });
    // One address selected: the label would only repeat the filter.
    expect(host.querySelector('li')?.textContent).not.toContain('Savings');
  });

  it('starts over when the balance total changes', async () => {
    const bal = (total: string): TokenBalances => ({
      denom: PAGE.denom,
      addresses: [],
      total,
      partial: false,
    });
    const { tick, calls, update } = setup(() => reply({ items: [item(1)] }), undefined, bal('1'));
    await tick();
    expect(calls).toHaveLength(1);
    update(bal('1'));
    await tick();
    expect(calls).toHaveLength(1);
    update(bal('2'));
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({});
  });

  it.each(['dark', 'light'] as const)('renders under the %s theme variables', async (scheme) => {
    const { host, tick } = setup(() => reply({ items: [item(1), item(2)] }));
    const style = new Map<string, string>();
    const dataset: { scheme?: string | undefined } = {};
    applyTheme(
      {
        style: {
          setProperty: (n, v) => {
            style.set(n, v);
          },
        },
        dataset,
      },
      {
        denom: PAGE.denom,
        branding: {
          font: 'inter',
          light: {
            background: '#FFFFFF',
            text: '#111111',
            primary: '#CC8800',
            secondary: '#888888',
          },
          dark: {
            background: '#000000',
            text: '#EEEEEE',
            primary: '#FFB000',
            secondary: '#777777',
          },
        },
        brandThemes: true,
        scheme,
      },
    );
    await tick();
    expect(style.get('--bp-primary')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(dataset.scheme).toBe(scheme);
    // The tab draws only with those variables: no scheme-specific markup to differ.
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('.bp-act-row')).not.toBeNull();
  });
});
