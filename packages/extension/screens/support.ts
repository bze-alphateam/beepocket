import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';

export { expect, test } from '../e2e/fixtures';

/** Where every shot lands: `screens-out/<name>-dark.png` and `-light.png` (git-ignored). */
export const OUT = resolve(import.meta.dirname, '../screens-out');

export const PASSWORD = 'correct horse battery';
export const PHRASE = `${'abandon '.repeat(23)}art`;

/** A factory token with a brand kit (the canvas's PAGE colours). */
export const PAGE = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pf7k/upage';

/** PAGE's logo as Scan lists it; the screens serve the extension icon in its place. */
const PAGE_LOGO =
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/beezee/images/page.png';

/** Four addresses: three hold funds, Cold is empty. Amounts in base units (6 decimals). */
export const ADDRESSES = [
  { label: 'Main', ubze: '12480520000', upage: '2000000000' },
  { label: 'Savings', ubze: '3200000000', upage: '0' },
  { label: 'Trading', ubze: '41750000', upage: '150000000' },
  { label: 'Cold', ubze: '0', upage: '0' },
].map((a, index) => ({ ...a, index, address: deriveAccount(PHRASE, index).address }));

export const CONTACTS = [
  { name: 'Alex', address: deriveAccount(PHRASE, 7).address },
  { name: 'Exchange deposit', address: deriveAccount(PHRASE, 8).address },
  { name: 'Maria', address: deriveAccount(PHRASE, 9).address },
];

const PAGE_METADATA = {
  metadata: {
    description: 'Page',
    denom_units: [
      { denom: PAGE, exponent: 0, aliases: [] },
      { denom: 'PAGE', exponent: 6, aliases: [] },
    ],
    base: PAGE,
    display: 'PAGE',
    name: 'Page',
    symbol: 'PAGE',
  },
};

const PAGE_BRANDING = {
  branding: {
    font: 'inter',
    dark: { background: '#1A0F0B', text: '#FFEDD5', primary: '#FB923C', secondary: '#F9A8D4' },
    light: { background: '#FFF7ED', text: '#1F1410', primary: '#C2410C', secondary: '#9F1239' },
  },
};

const fixture = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../../core/test/fixtures/rest/mainnet', `${name}.json`),
        'utf8',
      ),
    ) as { body: unknown }
  ).body;

/** Plays the BZE node and Scan for the data set above; anything else is a 404. */
export async function mockNetwork(context: BrowserContext): Promise<void> {
  await context.route('https://explorer.getbze.com/**', (route) =>
    route.fulfill({ status: 404, json: {} }),
  );
  // PAGE has a GitHub-hosted logo (the extension icon stands in for it); nothing else has one.
  await context.route('https://explorer.getbze.com/api/v1/registry/assets/**', (route) => {
    const denom = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').pop() ?? '',
    );
    return denom === PAGE
      ? route.fulfill({ json: { denom, logo: PAGE_LOGO } })
      : route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
  });
  await context.route(PAGE_LOGO, (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: readFileSync(join(import.meta.dirname, '../public/icons/icon-128.png')),
    }),
  );
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const denom = url.searchParams.get('denom');
    const balances = /\/cosmos\/bank\/v1beta1\/balances\/(.+)$/.exec(path);
    if (balances?.[1] !== undefined) {
      const holder = ADDRESSES.find((a) => a.address === decodeURIComponent(balances[1] ?? ''));
      const coins = [
        { denom: 'ubze', amount: holder?.ubze ?? '0' },
        { denom: PAGE, amount: holder?.upage ?? '0' },
      ].filter((c) => c.amount !== '0');
      return route.fulfill({
        json: { balances: coins, pagination: { next_key: null, total: String(coins.length) } },
      });
    }
    if (path.endsWith('/supply/by_denom')) {
      return route.fulfill({ json: { amount: { denom, amount: '1000000000000' } } });
    }
    if (path.endsWith('/denoms_metadata_by_query_string') && denom === PAGE) {
      return route.fulfill({ json: PAGE_METADATA });
    }
    if (path.endsWith('/denom_branding') && denom === PAGE) {
      return route.fulfill({ json: PAGE_BRANDING });
    }
    switch (path) {
      case '/bze/txfeecollector/params':
        return route.fulfill({ json: fixture('fee-params') });
      case '/bze/tradebin/params':
        return route.fulfill({ json: fixture('tradebin-params') });
      case '/bze/tradebin/all_liquidity_pools':
        return route.fulfill({ json: { list: [], pagination: { next_key: null, total: '0' } } });
      case '/bze/tradebin/halted_denoms':
        return route.fulfill({ json: { denoms: [], pagination: { next_key: null, total: '0' } } });
      default:
        return route.fulfill({ status: 404, json: { code: 5, message: 'not found', details: [] } });
    }
  });
}

/** One runtime message to the worker, as the popup sends it. */
export async function call(page: Page, method: string, payload: unknown = {}): Promise<unknown> {
  return page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), {
    method,
    payload,
  });
}

/**
 * Opens the popup at 360 × 600 with the appearance set to `system`, so `shot` can switch the
 * scheme live through the OS colour scheme.
 */
export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  await mockNetwork(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(page, 'appearance.set', { appearance: 'system' });
  return page;
}

/** The full data set: four addresses with labels, BZE and PAGE picked, three contacts. */
export async function seedWallet(page: Page): Promise<void> {
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  for (let i = 1; i < ADDRESSES.length; i++) await call(page, 'wallet.deriveNext');
  for (const { index, label } of ADDRESSES) {
    await call(page, 'wallet.renameAddress', { index, label });
  }
  await call(page, 'tokens.add', { denom: 'ubze' });
  await call(page, 'tokens.add', { denom: PAGE });
  for (const c of CONTACTS) await call(page, 'book.add', c);
}

/** Reloads the popup and waits until the screen shows `ready`. */
export async function reload(page: Page, ready: string): Promise<void> {
  await page.reload();
  await page.getByText(ready).first().waitFor();
}

/** Screenshots the popup in both schemes: `<name>-dark.png`, then `<name>-light.png`. */
export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // The 0.35 s theme fade would be caught mid-blend.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForFunction((s) => document.documentElement.dataset.scheme === s, scheme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
}
