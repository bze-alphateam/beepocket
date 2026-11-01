import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const GOLD = 'factory/bze1recorded/gold';
const MAIN = deriveAccount(PHRASE, 0).address;

/** Plays the BZE node: the main address holds 1.5 BZE and 2 GOLD, everything else is empty. */
async function mockNode(context: BrowserContext): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const notFound = { status: 404, json: { code: 5, message: 'not found', details: [] } };
    const balances = /\/cosmos\/bank\/v1beta1\/balances\/(.+)$/.exec(url.pathname);
    if (balances?.[1] !== undefined) {
      const mine = decodeURIComponent(balances[1]) === MAIN;
      const coins = mine
        ? [
            { denom: 'ubze', amount: '1500000' },
            { denom: GOLD, amount: '2000000' },
          ]
        : [];
      return route.fulfill({
        json: { balances: coins, pagination: { next_key: null, total: String(coins.length) } },
      });
    }
    const denom = url.searchParams.get('denom');
    if (url.pathname.endsWith('/supply/by_denom')) {
      return route.fulfill({ json: { amount: { denom, amount: '1000000' } } });
    }
    if (url.pathname.endsWith('/denoms_metadata_by_query_string') && denom === GOLD) {
      return route.fulfill({
        json: {
          metadata: {
            description: 'Gold',
            denom_units: [
              { denom: GOLD, exponent: 0, aliases: [] },
              { denom: 'GOLD', exponent: 6, aliases: [] },
            ],
            base: GOLD,
            display: 'GOLD',
            name: 'Gold Coin',
            symbol: 'GOLD',
          },
        },
      });
    }
    if (url.pathname.endsWith('/denom_branding') && denom === GOLD) {
      return route.fulfill({
        json: {
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
        },
      });
    }
    return route.fulfill(notFound);
  });
}

async function call(page: Page, method: string, payload: unknown): Promise<void> {
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

test('home shows balances, derives, renames and re-themes per token', async ({
  context,
  extensionId,
}) => {
  // Creating the wallet runs the real key derivation, which is slow on CI.
  test.setTimeout(90_000);
  await mockNode(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(page, 'tokens.add', { denom: 'ubze' });
  await call(page, 'tokens.add', { denom: GOLD });
  await page.reload();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('1.50');
  await expect(page.getByText('in your address')).toBeVisible();

  await page.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByRole('dialog', { name: 'Address added' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Label' }).fill('Savings');
  await page.getByRole('button', { name: 'Done' }).click();
  // The new address holds nothing yet, so it folds away.
  await page.getByRole('button', { name: 'Show 1 empty address' }).click();
  await expect(page.getByRole('button', { name: 'Rename Savings' })).toBeVisible();

  await page.getByRole('button', { name: 'Rename Main' }).click();
  await page.getByRole('textbox', { name: 'Label' }).fill('Daily');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Rename Daily' })).toBeVisible();

  const primary = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--bp-primary'));
  const before = await primary();
  await page.getByRole('button', { name: 'Choose token' }).click();
  await page.getByRole('button', { name: 'GOLD', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2.00');
  await expect.poll(primary).not.toBe(before);
});
