import type { BrowserContext, Page } from '@playwright/test';
import { mockReply } from '../e2e/mock-server';
import {
  ADDRESSES,
  call,
  CONTACTS,
  openPopup,
  PAGE,
  PASSWORD,
  reload,
  seedWallet,
  shot,
  test,
} from './support';

// The Activity tab of Home (W-Activity, W-Activity-Filter, W-Activity-Addr, W-Activity-PAGE,
// W-Activity-Empty, W-Activity-More and the W-Light-Activity* twins).

const GUILD = 'factory/bze1x7dp0f9cq3w8u5ya2fhd2uzt6jx2g0c7s4k9m3/uguild';
const GUILD_BRANDING = {
  font: 'inter',
  dark: { background: '#140E22', text: '#F5F0FF', primary: '#C4B5FD', secondary: '#E5C46B' },
  light: { background: '#FFFDF7', text: '#1E1433', primary: '#5B21B6', secondary: '#7A5F12' },
};

/** What the mock Scan answers: board-like rows, the recorded e2e feed, or nothing. */
type Feed = 'board' | 'fixtures' | 'empty';

const HOUR = 3_600_000;
const BZE = (amount: string) => ({ denom: 'ubze', amount, symbol: 'BZE', exponent: 6 });
const PAGE_DELTA = (amount: string) => ({ denom: PAGE, amount, symbol: 'PAGE', exponent: 6 });
const USDC = (amount: string) => ({
  denom: 'factory/bze1usdc/uusdc',
  amount,
  symbol: 'USDC',
  exponent: 6,
});

interface Row {
  hours: number;
  kind: string;
  category: string;
  signer: boolean;
  deltas: ReturnType<typeof BZE>[];
  cp?: { address: string; label?: string; moniker?: string };
  success?: boolean;
}

const pool = (name: string) => ({
  address: 'bze1pool0000000000000000000000000000000000',
  label: name,
});

/** Per address index, newest first: the canvas's BZE sample in Scan's own words. */
const BOARD: Row[][] = [
  [
    {
      hours: 2,
      kind: 'send',
      category: 'sent',
      signer: true,
      deltas: [BZE('-250000000')],
      cp: { address: CONTACTS[0]?.address ?? '' },
    },
    {
      hours: 40,
      kind: 'send',
      category: 'received',
      signer: false,
      deltas: [PAGE_DELTA('50000000000')],
      cp: { address: 'bze1w4h8c1m6x3k9q2s7n0d5v8r1p4j7t0l3gq' },
    },
    {
      hours: 60,
      kind: 'send',
      category: 'sent',
      signer: true,
      deltas: [BZE('-75000000')],
      cp: { address: 'bze1e7x2n9q4k1w8s5d0m3v6c2h7r4p9j1t5ru' },
      success: false,
    },
    {
      hours: 100,
      kind: 'delegate',
      category: 'staking',
      signer: true,
      deltas: [BZE('-1000000000')],
      cp: { address: 'bzevaloper1hive', moniker: 'Hive Node' },
    },
  ],
  [
    {
      hours: 18,
      kind: 'send',
      category: 'received',
      signer: false,
      deltas: [BZE('3500000000')],
      cp: { address: 'bze1q7zv3k9m2x6c0w4s8n5d1h7r3p9j6t2l0yc' },
    },
  ],
  [
    {
      hours: 7,
      kind: 'dex_swap',
      category: 'dex',
      signer: true,
      deltas: [BZE('-1000000000'), USDC('120400000')],
      cp: pool('BZE/USDC'),
    },
    {
      hours: 21,
      kind: 'dex_fill',
      category: 'dex',
      signer: false,
      deltas: [BZE('120000000')],
      cp: pool('BZE/USDC'),
    },
    {
      hours: 21.2,
      kind: 'dex_order',
      category: 'dex',
      signer: true,
      deltas: [BZE('-500000000')],
      cp: pool('BZE/USDC'),
    },
  ],
  [
    {
      hours: 150,
      kind: 'burner_fund',
      category: 'burner',
      signer: true,
      deltas: [BZE('-10000000')],
      cp: { address: 'bze1burner', label: 'Burner' },
    },
  ],
];

const scanRow = (r: Row, i: number) => ({
  time: new Date(Date.now() - r.hours * HOUR).toISOString(),
  height: 1_000_000 - i,
  tx_hash: `BOARD${String(i)}`,
  kind: r.kind,
  category: r.category,
  is_signer: r.signer,
  success: r.success ?? true,
  counterparty:
    r.cp === undefined
      ? null
      : {
          address: r.cp.address,
          label: r.cp.label === undefined ? null : { name: r.cp.label, kind: 'service' },
          moniker: r.cp.moniker ?? null,
        },
  deltas: r.deltas,
  msg_types: [],
  details: null,
  fee: null,
});

/** Plays BZE Scan's activity endpoint; `feed.current` picks the answer for the next calls. */
async function mockScan(context: BrowserContext): Promise<{ current: Feed }> {
  const feed: { current: Feed } = { current: 'board' };
  await context.route('https://explorer.getbze.com/api/v1/accounts/**', (route) => {
    const url = new URL(route.request().url());
    const holder = /\/accounts\/([^/]+)\/activity$/.exec(url.pathname)?.[1];
    if (feed.current === 'fixtures') {
      const reply = mockReply(url.pathname + url.search);
      return route.fulfill({ status: reply.status, json: reply.body });
    }
    const at = ADDRESSES.findIndex((a) => a.address === holder);
    const rows = feed.current === 'empty' ? [] : (BOARD[at] ?? []).map(scanRow);
    return route.fulfill({ json: { items: rows, next_cursor: null } });
  });
  return feed;
}

/** GUILD's metadata, brand kit and balances (420 on Main, 88 on Cold). */
async function mockGuild(context: BrowserContext): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const denom = url.searchParams.get('denom');
    const balances = /\/cosmos\/bank\/v1beta1\/balances\/(.+)$/.exec(url.pathname);
    if (balances?.[1] !== undefined) {
      const at = ADDRESSES.findIndex((a) => a.address === decodeURIComponent(balances[1] ?? ''));
      const holder = ADDRESSES[at];
      const coins = [
        { denom: 'ubze', amount: holder?.ubze ?? '0' },
        { denom: PAGE, amount: holder?.upage ?? '0' },
        { denom: GUILD, amount: ['420000000', '0', '0', '88000000'][at] ?? '0' },
      ].filter((c) => c.amount !== '0');
      return route.fulfill({
        json: { balances: coins, pagination: { next_key: null, total: String(coins.length) } },
      });
    }
    if (denom === GUILD && url.pathname.endsWith('/denoms_metadata_by_query_string')) {
      return route.fulfill({
        json: {
          metadata: {
            description: 'Guild',
            denom_units: [
              { denom: GUILD, exponent: 0, aliases: [] },
              { denom: 'GUILD', exponent: 6, aliases: [] },
            ],
            base: GUILD,
            display: 'GUILD',
            name: 'Guild',
            symbol: 'GUILD',
          },
        },
      });
    }
    if (denom === GUILD && url.pathname.endsWith('/denom_branding')) {
      return route.fulfill({ json: { branding: GUILD_BRANDING } });
    }
    return route.fallback();
  });
}

async function home(context: BrowserContext, extensionId: string) {
  const page = await openPopup(context, extensionId);
  await mockGuild(context);
  const feed = await mockScan(context);
  await seedWallet(page);
  await call(page, 'tokens.add', { denom: GUILD });
  await call(page, 'wallet.unlock', { password: PASSWORD });
  await reload(page, 'Main');
  return { page, feed };
}

/** Opens the Activity tab and waits for the first page (or the empty state). */
async function openActivity(page: Page, ready: string): Promise<void> {
  await page.getByRole('tab', { name: 'Activity' }).click();
  await page.getByText(ready).first().waitFor();
  await page.waitForTimeout(300);
}

async function switchTo(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: `Switch token, current ${from}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: to, exact: true }).click();
  await page.getByRole('button', { name: `Switch token, current ${to}` }).waitFor();
  await page.getByRole('button', { name: `Send ${to}`, exact: true }).waitFor();
  await page.waitForTimeout(600);
}

async function pickAddress(page: Page, now: string, label: string): Promise<void> {
  await page.getByRole('button', { name: `Filter activity by address, now ${now}` }).click();
  await page.getByRole('dialog', { name: 'Show activity for' }).waitFor();
  await page.getByRole('radio', { name: label }).click();
  await page.getByRole('button', { name: `Filter activity by address, now ${label}` }).waitFor();
}

test('activity: list, filter sheet, one address, kits', async ({ context, extensionId }) => {
  const { page } = await home(context, extensionId);
  await openActivity(page, 'Sent');
  await shot(page, 'activity');

  await page.getByRole('button', { name: 'Filter activity by address, now All addresses' }).click();
  await page.getByRole('dialog', { name: 'Show activity for' }).waitFor();
  await page.waitForTimeout(300);
  await shot(page, 'activity-filter');
  await page.getByRole('radio', { name: 'Trading' }).click();
  await page.getByRole('button', { name: 'Filter activity by address, now Trading' }).waitFor();
  await page.getByText('Filled orders').waitFor();
  await page.waitForTimeout(300);
  await shot(page, 'activity-addr');
  await pickAddress(page, 'Trading', 'All addresses');

  await switchTo(page, 'BZE', 'PAGE');
  await openActivity(page, 'Sent');
  await shot(page, 'activity-page');

  await switchTo(page, 'PAGE', 'GUILD');
  await openActivity(page, 'Sent');
  await shot(page, 'activity-guild');
});

test('activity: empty, load more', async ({ context, extensionId }) => {
  const { page, feed } = await home(context, extensionId);
  feed.current = 'empty';
  await openActivity(page, 'No activity in the last 30 days');
  await shot(page, 'activity-empty');

  feed.current = 'fixtures';
  await page.getByRole('tab', { name: 'Addresses' }).click();
  await openActivity(page, 'Faucet');
  await page.getByRole('button', { name: 'Load more' }).click();
  await page.getByText('Showing 20 · last 30 days').waitFor();
  await page.getByRole('button', { name: 'Load more' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, 'activity-more');
});
