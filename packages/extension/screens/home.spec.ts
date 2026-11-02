import type { BrowserContext, Page } from '@playwright/test';
import {
  ADDRESSES,
  call,
  openPopup,
  PAGE,
  PASSWORD,
  reload,
  seedWallet,
  shot,
  test,
} from './support';

// Home, the token switcher and the address sheets (W-Home-*, W-Single-*, W-Switcher*, W-Copied,
// W-Rename, W-AddAddress and their W-Light-* twins).

const GUILD = 'factory/bze1x7dp0f9cq3w8u5ya2fhd2uzt6jx2g0c7s4k9m3/uguild';
const USDC = 'factory/bze1usdcxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/uusdc';
const VDL = 'factory/bze1vdlxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/uvdl';

/** Tokens on top of the shared data set: GUILD and VDL have brand kits, USDC has none. */
const EXTRA = [
  {
    denom: GUILD,
    symbol: 'GUILD',
    name: 'Guild',
    amounts: ['420000000', '0', '0', '88000000'],
    branding: {
      font: 'inter',
      dark: { background: '#140E22', text: '#F5F0FF', primary: '#C4B5FD', secondary: '#E5C46B' },
      light: { background: '#FFFDF7', text: '#1E1433', primary: '#5B21B6', secondary: '#7A5F12' },
    },
  },
  {
    denom: USDC,
    symbol: 'USDC',
    name: 'USD Coin',
    amounts: ['120500000', '0', '1204000000', '0'],
    branding: null,
  },
  {
    denom: VDL,
    symbol: 'VDL',
    name: 'Vidulum',
    amounts: ['0', '0', '0', '3200000000'],
    branding: {
      font: 'inter',
      dark: { background: '#071722', text: '#E0F2FE', primary: '#38BDF8', secondary: '#94A3B8' },
      light: { background: '#F0F9FF', text: '#0C1A2B', primary: '#0369A1', secondary: '#475569' },
    },
  },
];

/** Answers the extra tokens' metadata, branding and balances; the rest goes to `support.ts`. */
async function mockExtraTokens(context: BrowserContext): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const denom = url.searchParams.get('denom');
    const token = EXTRA.find((x) => x.denom === denom);
    const balances = /\/cosmos\/bank\/v1beta1\/balances\/(.+)$/.exec(url.pathname);
    if (balances?.[1] !== undefined) {
      const at = ADDRESSES.findIndex((a) => a.address === decodeURIComponent(balances[1] ?? ''));
      const holder = ADDRESSES[at];
      const coins = [
        { denom: 'ubze', amount: holder?.ubze ?? '0' },
        { denom: PAGE, amount: holder?.upage ?? '0' },
        ...EXTRA.map((x) => ({ denom: x.denom, amount: x.amounts[at] ?? '0' })),
      ].filter((c) => c.amount !== '0');
      return route.fulfill({
        json: { balances: coins, pagination: { next_key: null, total: String(coins.length) } },
      });
    }
    if (token && url.pathname.endsWith('/denoms_metadata_by_query_string')) {
      return route.fulfill({
        json: {
          metadata: {
            description: token.name,
            denom_units: [
              { denom: token.denom, exponent: 0, aliases: [] },
              { denom: token.symbol, exponent: 6, aliases: [] },
            ],
            base: token.denom,
            display: token.symbol,
            name: token.name,
            symbol: token.symbol,
          },
        },
      });
    }
    if (token?.branding && url.pathname.endsWith('/denom_branding')) {
      return route.fulfill({ json: { branding: token.branding } });
    }
    return route.fallback();
  });
}

async function home(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await mockExtraTokens(context);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedWallet(page);
  await call(page, 'tokens.add', { denom: USDC });
  await call(page, 'tokens.add', { denom: GUILD });
  await call(page, 'wallet.unlock', { password: PASSWORD });
  await reload(page, 'Main');
  return page;
}

async function switchTo(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: `Switch token, current ${from}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: to, exact: true }).click();
  await page.getByRole('button', { name: `Switch token, current ${to}` }).waitFor();
  // Balances and the kit arrive after the switch.
  await page.getByRole('button', { name: `Send ${to}`, exact: true }).waitFor();
  await page.waitForTimeout(600);
}

const closeSheet = (page: Page) => page.keyboard.press('Escape');

test('home: tokens, copy, rename, add, switcher', async ({ context, extensionId }) => {
  const page = await home(context, extensionId);
  await page.waitForTimeout(600);
  await shot(page, 'home-bze');

  await page.getByRole('button', { name: 'Copy address Savings' }).click();
  await page.getByText('Address copied').waitFor();
  await shot(page, 'home-copied');
  await page.getByText('Address copied').waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: 'Rename Savings' }).click();
  await page.getByRole('dialog', { name: 'Rename address' }).waitFor();
  await shot(page, 'home-rename');
  await closeSheet(page);

  await switchTo(page, 'BZE', 'GUILD');
  await shot(page, 'home-guild');
  await page.getByRole('button', { name: 'Switch token, current GUILD' }).click();
  await page.getByRole('dialog').getByText('You hold').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'home-switcher');
  await page.getByRole('searchbox', { name: 'Search tokens' }).fill('vi');
  await page.getByRole('dialog').getByText('Results').waitFor();
  await shot(page, 'home-switcher-search');
  await closeSheet(page);

  await switchTo(page, 'GUILD', 'USDC');
  await shot(page, 'home-usdc');

  await switchTo(page, 'USDC', 'PAGE');
  await shot(page, 'home-page');
  await page.getByRole('button', { name: 'Add address' }).click();
  await page.getByText("It's address #5 in this wallet.").waitFor();
  await shot(page, 'home-add');
  await closeSheet(page);
  await page.getByRole('button', { name: 'Show 2 empty addresses' }).click();
  await shot(page, 'home-page-empty');
});

test('home: theme follows token off, single token', async ({ context, extensionId }) => {
  const page = await home(context, extensionId);
  await call(page, 'settings.set', { brandThemes: false });
  await reload(page, 'Main');
  await switchTo(page, 'BZE', 'PAGE');
  await shot(page, 'home-kitoff');

  await call(page, 'settings.set', { brandThemes: true });
  for (const denom of ['ubze', USDC, GUILD]) await call(page, 'tokens.remove', { denom });
  await reload(page, 'Page wallet');
  await page.waitForTimeout(600);
  await shot(page, 'home-single-page');
});
