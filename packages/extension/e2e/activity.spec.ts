import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mockReply } from './mock-server';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const MAIN = deriveAccount(PHRASE, 0).address;

/** Plays a BZE node (1.5 BZE on the main address) and BZE Scan (25 incoming sends). */
async function mockNetwork(context: BrowserContext): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    if (/\/cosmos\/bank\/v1beta1\/balances\//.test(url.pathname)) {
      return route.fulfill({
        json: {
          balances: [{ denom: 'ubze', amount: '1500000' }],
          pagination: { next_key: null, total: '1' },
        },
      });
    }
    return route.fulfill({ status: 404, json: { code: 5, message: 'not found', details: [] } });
  });
  await context.route('https://explorer.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const reply = mockReply(url.pathname + url.search);
    return route.fulfill({ status: reply.status, json: reply.body });
  });
}

async function call(page: Page, method: string, payload: unknown): Promise<void> {
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

test.use({ actionTimeout: 10_000 });

test('the activity tab pages through 25 rows in three loads and reaches the end text', async ({
  context,
  extensionId,
}) => {
  // Creating the wallet runs the real key derivation, which is slow on CI.
  test.setTimeout(90_000);
  await mockNetwork(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(page, 'tokens.add', { denom: 'ubze' });
  await page.reload();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('1.50');
  await page.getByRole('tab', { name: 'Activity' }).click();

  const rows = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Received');
  await expect(rows.first()).toContainText('+1');
  await expect(rows.first()).toContainText('Faucet');

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows).toHaveCount(20);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows).toHaveCount(25);

  await expect(page.getByText("That's everything from the last 30 days")).toBeVisible();
  await expect(page.getByRole('link', { name: 'Older activity on Explorer' })).toHaveAttribute(
    'href',
    `https://explorer.getbze.com/accounts/${MAIN}`,
  );
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});
