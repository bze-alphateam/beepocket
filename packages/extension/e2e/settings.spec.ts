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
    if (/\/cosmos\/bank\/v1beta1\/balances\//.test(url.pathname) && amount !== undefined) {
      return route.fulfill({
        json: {
          balances: [{ denom: 'ubze', amount }],
          pagination: { next_key: null, total: '1' },
        },
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
  return await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), {
    method,
    payload,
  });
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
