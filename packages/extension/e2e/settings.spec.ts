import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;

/** Balances per node host: the same address holds different amounts on mainnet and testnet. */
async function mockNodes(context: BrowserContext): Promise<void> {
  const amounts: Record<string, string> = {
    'rest.getbze.com': '1000',
    'testnet.getbze.com': '777',
  };
  await context.route(/^https:\/\/(rest|testnet)\.getbze\.com\//, (route) => {
    const url = new URL(route.request().url());
    const amount = amounts[url.host];
    if (url.pathname.includes('/cosmos/bank/v1beta1/balances/') && amount !== undefined) {
      return route.fulfill({
        json: {
          balances: [{ denom: 'ubze', amount }],
          pagination: { next_key: null, total: '1' },
        },
      });
    }
    if (url.pathname.endsWith('/supply/by_denom')) {
      return route.fulfill({
        json: { amount: { denom: url.searchParams.get('denom'), amount: '1000000' } },
      });
    }
    return route.fulfill({ status: 404, json: { code: 5, message: 'not found', details: [] } });
  });
}

async function call(
  page: Page,
  method: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const reply = await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), {
    method,
    payload,
  });
  return reply as Record<string, unknown>;
}

test('testnet toggle switches the node, back again, and the phrase needs the password', async ({
  context,
  extensionId,
}) => {
  await mockNodes(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  const address = deriveAccount(PHRASE, 0).address;

  expect(await call(page, 'network.get', {})).toEqual({ ok: true, value: { id: 'mainnet' } });
  expect(await call(page, 'tokens.balances', { denom: 'ubze', refresh: true })).toMatchObject({
    value: { addresses: [{ address, amount: '1000' }] },
  });

  await call(page, 'network.set', { id: 'testnet' });
  expect(await call(page, 'tokens.balances', { denom: 'ubze', refresh: true })).toMatchObject({
    value: { addresses: [{ address, amount: '777' }] },
  });

  await call(page, 'network.set', { id: 'mainnet' });
  expect(await call(page, 'tokens.balances', { denom: 'ubze', refresh: true })).toMatchObject({
    value: { addresses: [{ address, amount: '1000' }] },
  });

  expect(await call(page, 'wallet.revealMnemonic', { password: 'wrong' })).toMatchObject({
    ok: true,
    value: { status: 'wrong-password' },
  });
  expect(await call(page, 'wallet.revealMnemonic', { password: PASSWORD })).toMatchObject({
    ok: true,
    value: { status: 'ok', mnemonic: PHRASE },
  });

  expect(await call(page, 'settings.set', { weakLockMinutes: 5 })).toMatchObject({ ok: true });
  expect(await call(page, 'settings.set', { fullLockMinutes: 1 })).toMatchObject({
    error: { code: 'invalid_settings' },
  });
});

test('home settings pages, Testnet toggle with pill, and the reveal page in the popup', async ({
  context,
  extensionId,
}) => {
  // Creating the wallet runs the real key derivation, which is slow on CI.
  test.setTimeout(90_000);
  await mockNodes(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(page, 'tokens.add', { denom: 'ubze' });
  await page.reload();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.bp-pill')).toHaveCount(0);
  await page.getByRole('button', { name: /^Configuration/ }).click();
  await page.getByRole('button', { name: /^Advanced/ }).click();

  // A click, not check(): the switch leaves the screen for "Pick your tokens" (no testnet
  // tokens yet), and check() hangs re-reading the state of a switch that is gone.
  await page.getByRole('switch', { name: /Testnet/ }).click();
  await expect(page.getByText('Pick your tokens')).toBeVisible();
  await expect(page.locator('.bp-pill')).toHaveText('Testnet');
  expect(await call(page, 'network.get', {})).toEqual({ ok: true, value: { id: 'testnet' } });

  await page.getByRole('button', { name: 'Switch network' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Configuration/ }).click();
  await page.getByRole('button', { name: /^Advanced/ }).click();
  await expect(page.getByRole('switch', { name: /Testnet/ })).not.toBeChecked();
  await expect(page.locator('.bp-pill')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Security/ }).click();
  await page.getByRole('button', { name: /Show recovery phrase/ }).click();
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(page.getByText('Wrong password.')).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  // The words stay behind the veil, out of the page, until asked for.
  await expect(page.locator('.bp-words li')).toHaveCount(24);
  await expect(page.getByText('abandon')).toHaveCount(0);
  await page.getByRole('button', { name: /Reveal phrase/ }).click();
  await expect(page.locator('.bp-words li', { hasText: 'abandon' })).toHaveCount(23);
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByText('abandon')).toHaveCount(0);
  // Hide leaves the phrase; the page goes back one level, to Security.
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
});
