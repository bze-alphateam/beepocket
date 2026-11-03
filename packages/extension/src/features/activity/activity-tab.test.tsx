import { render as preactRender } from 'preact';
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../protocol/client';
import {
  fail,
  ok,
  type ActivityAmount,
  type ActivityItem,
  type ActivityPageResult,
  type Contact,
  type OwnAddress,
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
import { ActivityFilterChip, ActivityTab } from './ActivityTab';
import { createAddressFilter, type AddressFilter } from './filter';

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

/** A transaction hash the way CometBFT writes it: 64 hex characters. */
const hash = (n: number) => n.toString(16).toUpperCase().padStart(64, '0');

const item = (n: number, over: Partial<ActivityItem> = {}): ActivityItem => ({
  addressIndex: 0,
  addressLabel: 'Main',
  time: '2026-10-31T13:39:14Z',
  txHash: hash(n),
  kind: 'send',
  category: 'received',
  isSigner: false,
  success: true,
  counterparty: null,
  counterpartyAddress: null,
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
  tokens: ListedToken[] = [PAGE],
  filter: AddressFilter = createAddressFilter(),
  book: { contacts: Contact[]; own: OwnAddress[] } = { contacts: [], own: [] },
) {
  const calls: RequestOf<'activity.page'>[] = [];
  const client: Client = {
    call: vi.fn(<M extends Method>(method: M, req: RequestOf<M>) => {
      if (method === 'book.list') return Promise.resolve(ok(book) as never);
      calls.push(req as RequestOf<'activity.page'>);
      return Promise.resolve(pages(req as RequestOf<'activity.page'>) as never);
    }),
  };
  const view = (b: TokenBalances | null, list = addresses) => (
    <ClientProvider client={client}>
      <ActivityFilterChip addresses={list} filter={filter} />
      <ActivityTab tokens={tokens} addresses={list} balances={b} filter={filter} />
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
    update: (b: TokenBalances | null, list = addresses) => {
      void act(() => {
        preactRender(view(b, list), host);
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

const IBC = 'ibc/6490A7EA3C2D8B1F4E5A9C0D7B3F2E1A6C8D4B5E9F0A1C2D3E4F5A6B7C8D9E0F';
const RAW = '1250000000000000000000000';

describe('ActivityTab card', () => {
  const cards = async (items: ActivityItem[]) => {
    const { host, tick } = setup(() => reply({ items }));
    await tick();
    return host;
  };
  const rowsOf = (card: Element) => card.querySelectorAll('.bp-act-asset');

  it.each([1, 2, 3])('has a summary, an address row and %i asset row(s)', async (n) => {
    const amounts = [
      amt('-2000'),
      amt('500', { denom: 'ubze', symbol: 'BZE', exponent: 6 }),
      amt('7'),
    ]
      .slice(0, n)
      .map((a, i) => ({ ...a, denom: `${a.denom}${String(i)}` }));
    const host = await cards([item(1, { kind: 'dex_swap', counterparty: 'BZE/PAGE', amounts })]);
    const card = host.querySelector('a.bp-act-card');
    expect(card?.querySelector('.bp-act-what')?.textContent).toBe('Swap');
    expect(card?.querySelector('.bp-act-address')?.textContent).toContain('Main');
    expect(card?.querySelector('.bp-act-address')?.textContent).toContain('BZE/PAGE');
    expect(host.querySelectorAll('a.bp-act-card .bp-act-asset')).toHaveLength(n);
    expect(card?.getAttribute('href')).toBe(`https://explorer.example/txs/${hash(1)}`);
  });

  it('renders a 25-digit raw amount of an unknown token in full, with a short muted symbol', async () => {
    const host = await cards([
      item(1, {
        category: 'received',
        amounts: [amt(RAW, { denom: IBC, symbol: null, exponent: null })],
      }),
    ]);
    const amount = host.querySelector('.bp-act-amount');
    expect(amount?.textContent).toBe('+1,250,000,000,000,000,000,000,000');
    const symbol = host.querySelector('.bp-act-symbol');
    expect(symbol?.textContent).toBe('ibc/6490…9E0F');
    expect(symbol?.getAttribute('title')).toBe(IBC);
    expect(symbol?.hasAttribute('data-unknown')).toBe(true);
    expect(host.querySelector('a.bp-act-card')?.getAttribute('aria-label')).toContain(
      'unknown token ibc/6490…9E0F',
    );
  });

  it('keeps a registered symbol plain, next to an unknown one in the same swap', async () => {
    const host = await cards([
      item(1, {
        kind: 'dex_swap',
        amounts: [
          amt('-4000', { denom: 'ubze', symbol: 'BZE', exponent: 2 }),
          amt('31', { denom: 'factory/bze1x/uguildcoinxyz', symbol: null, exponent: null }),
        ],
      }),
    ]);
    const [reg, unk] = [...host.querySelectorAll('.bp-act-symbol')];
    expect(reg?.hasAttribute('data-unknown')).toBe(false);
    expect(reg?.getAttribute('title')).toBeNull();
    expect(unk?.textContent).toBe('factory/…/uguildcoi…');
    expect(unk?.hasAttribute('data-unknown')).toBe(true);
    const label = host.querySelector('a')?.getAttribute('aria-label') ?? '';
    expect(label).not.toContain('unknown token BZE');
    expect(label).toContain('unknown token factory/…/uguildcoi…');
  });

  it('reads another registered token the way the wallet knows it, never as unknown', async () => {
    const OTHER: ListedToken = {
      ...PAGE,
      denom: 'factory/bze1x/other',
      symbol: 'OTHER',
      decimals: 3,
    };
    const { host, tick } = setup(
      () =>
        reply({
          items: [
            item(1, {
              kind: 'dex_swap',
              amounts: [
                amt('-4000', { denom: 'ubze', symbol: 'BZE', exponent: 2 }),
                amt('2500', { denom: OTHER.denom, symbol: null, exponent: null }),
              ],
            }),
          ],
        }),
      undefined,
      null,
      [PAGE, OTHER],
    );
    await tick();
    const text = host.querySelector('a.bp-act-card')?.textContent ?? '';
    expect(text).toContain('OTHER');
    expect(text).toContain('+2.50');
    expect(text).not.toContain('factory/…');
    expect(host.querySelector('a.bp-act-card')?.getAttribute('aria-label')).not.toContain(
      'unknown token',
    );
    expect(host.querySelectorAll('[data-unknown]')).toHaveLength(0);
  });

  it('tags a failed card, strikes its amounts and says so to screen readers', async () => {
    const host = await cards([
      item(1, { success: false, kind: 'send', category: 'sent', amounts: [amt('-100')] }),
    ]);
    const card = host.querySelector('a.bp-act-card');
    expect(card?.hasAttribute('data-failed')).toBe(true);
    expect(card?.querySelector('.bp-tag-bad')?.textContent).toBe('Failed');
    expect(card?.querySelector('.bp-icon-tile-bad')).not.toBeNull();
    expect(card?.querySelector('.bp-act-what')?.textContent).toContain('Send');
    expect(card?.getAttribute('aria-label')).toContain('Failed');
    expect(card?.getAttribute('aria-label')).toContain('Opens on Explorer');
  });

  it('shows a fee-only row as one negative amount titled Network fee', async () => {
    const host = await cards([item(1, { kind: 'fee_only', feeOnly: true, amounts: [amt('-7')] })]);
    const card = host.querySelector('a.bp-act-card');
    if (!card) throw new Error('no card');
    expect(card.querySelector('.bp-act-what')?.textContent).toBe('Network fee');
    expect(rowsOf(card)).toHaveLength(1);
    expect(card.querySelector('.bp-act-amount')?.textContent).toBe('−0.07');
    expect(card.querySelector('.bp-act-amount')?.hasAttribute('data-negative')).toBe(true);
  });
});

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
    expect(rows[0]).toContain('Receive');
    expect(rows[0]).toContain('+1.50');
    expect(rows[0]).toContain('PAGE');
    expect(rows[0]).toContain('Exchange');
    expect(rows[1]).toContain('Swap');
    expect(rows[1]).toContain('Failed');
    expect(rows[1]).toContain('−25');
    expect(rows[2]).toContain('Network fee');
    expect(rows[2]).toContain('−0.07');
    expect(rows[3]).toContain('Network fee');
    expect(rows[3]).toContain('Staked');
    expect(rows[3]).toContain('−0.03');
    expect(host.textContent).toContain("That's everything from the last 30 days");
    expect(host.querySelector('.bp-act-end a')?.getAttribute('href')).toBe(
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
    expect(first).toContain('−2.00');
    expect(first).toContain('BZE');
    expect(first).toContain('+5.00');
    expect(first).toContain('+42');
    expect(first).toContain('factory/…/zzz');
    expect(first.indexOf('−2.00')).toBeLessThan(first.indexOf('+5.00'));
    expect(rows[1]?.textContent).toContain('Swap');
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
    click(host, 'Try again');
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
    click(host, 'Try again');
    await tick();
    expect(calls.at(-1)).toEqual({ cursor: 'c1' });
    expect(host.querySelectorAll('li')).toHaveLength(2);
  });

  it('filters by address from the chip sheet and labels rows when several addresses are merged', async () => {
    const { host, tick, calls } = setup(
      (req) =>
        reply({
          items: [item(1, { addressIndex: req.addressIndex ?? 1, addressLabel: 'Savings' })],
        }),
      [addr(0, 'Main'), addr(1, 'Savings')],
    );
    await tick();
    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('li')?.textContent).toContain('Savings');
    const chip = host.querySelector('button.bp-dropdown');
    expect(chip?.getAttribute('aria-label')).toBe('Filter activity by address, now All addresses');
    fireEvent(chip, 'click');
    const sheet = host.querySelector('[role="dialog"]');
    expect(sheet?.getAttribute('aria-label')).toBe('Show activity for');
    const options = [...(sheet?.querySelectorAll('[role="radio"]') ?? [])];
    expect(options.map((o) => o.querySelector('.bp-choice-label')?.textContent)).toEqual([
      'All addresses',
      'Main',
      'Savings',
    ]);
    expect(options[0]?.textContent).toContain('2 addresses');
    fireEvent(options[1], 'click');
    await tick();
    expect(calls.at(-1)).toEqual({ addressIndex: 0 });
    expect(host.querySelector('button.bp-dropdown')?.getAttribute('aria-label')).toBe(
      'Filter activity by address, now Main',
    );
    expect(host.querySelector('.bp-filter-chip')?.hasAttribute('data-on')).toBe(true);
    // The card names its address whatever the filter says (the stub answers with Savings).
    expect(host.querySelector('.bp-act-addr-label')?.textContent).toBe('Savings');
  });

  it('has no chip for a single address', async () => {
    const { host, tick } = setup(() => reply({ items: [item(1)] }));
    await tick();
    expect(host.querySelector('.bp-dropdown')).toBeNull();
  });

  it('reads a filter on an address the wallet no longer has as all addresses', async () => {
    const filter = createAddressFilter();
    filter.set(2);
    const { host, tick, calls } = setup(
      () => reply({ items: [item(1)] }),
      [addr(0, 'Main'), addr(1, 'Savings')],
      null,
      [PAGE],
      filter,
    );
    await tick();
    expect(calls[0]).toEqual({});
    expect(host.querySelector('button.bp-dropdown')?.getAttribute('aria-label')).toBe(
      'Filter activity by address, now All addresses',
    );
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
    expect(host.querySelectorAll('.bp-act-card')).toHaveLength(2);
  });
});

/** Scan's documented kinds (the words test's fixture): every one needs an icon and an arrow. */
const KINDS = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../test/fixtures/scan-kinds.json'), 'utf8'),
  ) as { kinds: string[] }
).kinds;

describe('ActivityTab kinds', () => {
  const render1 = async (over: Partial<ActivityItem>) => {
    const { host, tick } = setup(() =>
      reply({ items: [item(1, { counterparty: 'Alex', ...over })] }),
    );
    await tick();
    const card = host.querySelector('a.bp-act-card');
    if (!card) throw new Error('no card');
    return card;
  };
  const iconOf = (card: Element) =>
    card.querySelector('.bp-icon-tile [data-icon]')?.getAttribute('data-icon');
  const arrowOf = (card: Element) => card.querySelector('.bp-act-arrow')?.textContent ?? null;

  it.each(KINDS.flatMap((kind) => [true, false].map((isSigner) => [kind, isSigner] as const)))(
    '%s (signer %s) has a kind icon on the soft disc and an arrow',
    async (kind, isSigner) => {
      const card = await render1({ kind, isSigner, category: 'other' });
      expect(iconOf(card)).toBeDefined();
      expect(iconOf(card)).not.toBe('dot');
      expect(card.querySelector('.bp-icon-tile-soft')).not.toBeNull();
      expect(['→', '←', '·']).toContain(arrowOf(card));
    },
  );

  it.each([
    ['sent', 'send', '→', 'Send'],
    ['received', 'receive', '←', 'Receive'],
  ])('reads a send by its %s category', async (category, icon, arrow, words) => {
    const card = await render1({ kind: 'send', category });
    expect(iconOf(card)).toBe(icon);
    expect(arrowOf(card)).toBe(arrow);
    expect(card.querySelector('.bp-act-what')?.textContent).toBe(words);
  });

  it('draws a swap with the swap icon and a dot between address and pair', async () => {
    const card = await render1({ kind: 'dex_swap', counterparty: 'BZE/USDC' });
    expect(iconOf(card)).toBe('swap');
    expect(card.querySelector('.bp-act-address')?.textContent).toBe('Main·BZE/USDC');
  });

  it('gives an unknown kind a neutral dot icon and no arrow', async () => {
    const card = await render1({ kind: 'brand_new_kind' });
    expect(iconOf(card)).toBe('dot');
    expect(card.querySelector('.bp-icon-tile-inset')).not.toBeNull();
    expect(card.querySelector('.bp-act-arrow')).toBeNull();
    expect(card.querySelector('.bp-act-what')?.textContent).toBe('Transaction');
    expect(card.querySelector('.bp-act-cp')?.textContent).toBe('Alex');
    expect(card.querySelector('.bp-act-amount')?.textContent).toBe('1.50');
  });

  it('keeps the sign of a known kind', async () => {
    const card = await render1({ kind: 'dex_swap', amounts: [amt('150'), amt('-25')] });
    expect([...card.querySelectorAll('.bp-act-amount')].map((a) => a.textContent)).toEqual([
      '+1.50',
      '−0.25',
    ]);
  });

  it('shows the time under the amounts and colours them by sign', async () => {
    const card = await render1({ amounts: [amt('-2500'), amt('700', { denom: 'ubze' })] });
    expect(card.querySelector('.bp-feed-row-caption')?.textContent).toMatch(/·/);
    const amounts = [...card.querySelectorAll('.bp-feed-row-value .bp-act-amount')];
    expect(amounts.map((a) => a.textContent)).toEqual(['−25.00', '+7.00']);
    expect(amounts.map((a) => a.hasAttribute('data-negative'))).toEqual([true, false]);
  });
});

describe('ActivityTab states', () => {
  it('shows the empty state with its icon, words and the Explorer link', async () => {
    const { host, tick } = setup(() => reply({}));
    await tick();
    expect(host.querySelector('.bp-empty [data-icon="activity"]')).not.toBeNull();
    expect(host.querySelector('.bp-empty-sub')?.textContent).toBe(
      'Sends, swaps and orders show up here.',
    );
    expect(host.textContent).not.toContain("That's everything");
    expect(host.querySelector('.bp-act-end a')?.getAttribute('href')).toBe(
      'https://explorer.example/accounts/bze1a',
    );
  });

  it('says how many rows show while more can load', async () => {
    const { host, tick } = setup(() =>
      reply({ items: [item(1), item(2)], cursor: 'c1', done: false }),
    );
    await tick();
    expect(host.querySelector('.bp-act-foot')?.textContent).toBe('Showing 2 · last 30 days');
    expect(host.querySelector('.bp-act-end')).toBeNull();
  });

  it('shows the error as an empty state with a ghost Try again', async () => {
    const { host, tick } = setup(() => fail('activity-unavailable', 'down'));
    await tick();
    expect(host.querySelector('[role="alert"] .bp-empty-title')?.textContent).toBe(
      "Couldn't load activity",
    );
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    expect(retry?.className).toContain('bp-btn-ghost');
  });
});

describe('ActivityTab links', () => {
  it('links a real transaction hash and leaves any other hash unlinked', async () => {
    const { host, tick } = setup(() =>
      reply({
        items: [
          item(1),
          item(2, { txHash: '../../evil?x=1' }),
          item(3, { txHash: 'ab'.repeat(31) }),
          item(4, { txHash: null }),
        ],
      }),
    );
    await tick();
    const rows = [...host.querySelectorAll('.bp-act-card')];
    expect(rows.map((r) => r.tagName)).toEqual(['A', 'DIV', 'DIV', 'A']);
    expect(rows[0]?.getAttribute('href')).toBe(`https://explorer.example/txs/${hash(1)}`);
    expect(rows[1]?.getAttribute('aria-label')).not.toContain('Opens on Explorer');
    // A block-level row has no transaction: it opens the account page.
    expect(rows[3]?.getAttribute('href')).toBe('https://explorer.example/accounts/bze1a');
    expect(host.querySelector('a[href*="evil"]')).toBeNull();
  });
});

describe('ActivityTab names', () => {
  const ALEX = 'bze1alexalexalexalexalexalexalexalexalexale';
  const SAVINGS = 'bze1savingssavingssavingssavingssavingssav';
  const OTHER = 'bze1otherotherotherotherotherotherotherothe';

  it("names a counterparty from the address book or the wallet, else shows Scan's short form once", async () => {
    const { host, tick } = setup(
      () =>
        reply({
          items: [
            item(1, { counterparty: 'bze1alex…xale', counterpartyAddress: ALEX }),
            item(2, { counterparty: 'bze1savi…ssav', counterpartyAddress: SAVINGS }),
            item(3, { counterparty: 'bze1othe…othe', counterpartyAddress: OTHER }),
          ],
        }),
      undefined,
      null,
      [PAGE],
      undefined,
      {
        contacts: [{ name: 'Alex', address: ALEX }],
        own: [{ label: 'Savings', address: SAVINGS }],
      },
    );
    await tick();
    const cps = [...host.querySelectorAll('.bp-act-cp')];
    expect(cps.map((c) => c.textContent)).toEqual(['Alex', 'Savings', 'bze1oth…rothe']);
    expect(cps.map((c) => c.hasAttribute('data-mono'))).toEqual([false, false, true]);
    expect(host.querySelector('a.bp-act-card')?.getAttribute('aria-label')).toContain('Main Alex');
  });
});

describe('ActivityTab paging', () => {
  it('reads one page per Load more, however often it is pressed', async () => {
    const { host, tick, calls } = setup((req) =>
      req.cursor === undefined
        ? reply({ items: [item(1)], cursor: 'c1', done: false })
        : reply({ items: [item(2)] }),
    );
    await tick();
    const more = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Load more');
    if (!more) throw new Error('no Load more');
    // A double click: both presses land before the button re-renders.
    void act(() => {
      more.click();
      more.click();
    });
    await tick();
    expect(calls).toEqual([{}, { cursor: 'c1' }]);
    expect(host.querySelectorAll('li')).toHaveLength(2);
  });

  it('reads on past an empty first page that still has older pages', async () => {
    const { host, tick, calls } = setup((req) =>
      req.cursor === undefined
        ? reply({ items: [], cursor: 'c1', done: false })
        : reply({ items: [item(1)] }),
    );
    await tick();
    expect(calls).toEqual([{}, { cursor: 'c1' }]);
    expect(host.querySelectorAll('li')).toHaveLength(1);
  });

  it('shows the empty state, not a bare Load more, after three empty pages', async () => {
    const { host, tick, calls } = setup(() => reply({ items: [], cursor: 'c', done: false }));
    await tick();
    await tick();
    expect(calls).toHaveLength(3);
    expect(host.querySelector('.bp-empty-title')?.textContent).toBe(
      'No activity in the last 30 days',
    );
    expect(host.textContent).toContain('Load more');
  });
});

describe('ActivityTab filter by keyboard', () => {
  it('opens from the focused chip, moves focus into the sheet and picks with the keyboard', async () => {
    const { host, tick, calls } = setup(
      () => reply({ items: [item(1)] }),
      [addr(0, 'Main'), addr(1, 'Savings')],
    );
    await tick();
    const chip = host.querySelector<HTMLButtonElement>('button.bp-dropdown');
    if (!chip) throw new Error('no chip');
    expect(chip.tagName).toBe('BUTTON');
    chip.focus();
    // Enter or Space on a focused button is a click.
    fireEvent(chip, 'click');
    const sheet = host.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(sheet);
    const tab = () => {
      fireEvent(document.body, 'keydown', { key: 'Tab' });
    };
    tab();
    // The title row's × comes first, then the options.
    expect(document.activeElement).toBe(sheet?.querySelector('[aria-label="Close"]'));
    const radios = [...(sheet?.querySelectorAll('[role="radio"]') ?? [])];
    fireEvent(document.body, 'keydown', { key: 'Tab', shiftKey: true });
    // Shift+Tab from the × wraps to the last option (Savings).
    expect(document.activeElement).toBe(radios[2]);
    fireEvent(document.activeElement, 'click');
    await tick();
    expect(calls.at(-1)).toEqual({ addressIndex: 1 });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button.bp-dropdown'));
  });

  it('closes on Escape without changing the filter', async () => {
    const { host, tick, calls } = setup(
      () => reply({ items: [item(1)] }),
      [addr(0, 'Main'), addr(1, 'Savings')],
    );
    await tick();
    fireEvent(host.querySelector('button.bp-dropdown'), 'click');
    fireEvent(document.body, 'keydown', { key: 'Escape' });
    await tick();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toEqual([{}]);
  });
});
