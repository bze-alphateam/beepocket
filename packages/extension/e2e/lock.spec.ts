import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;

async function open(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

async function call(page: Page, method: string, payload: unknown): Promise<void> {
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

async function lockedWallet(context: BrowserContext, extensionId: string): Promise<void> {
  const setup = await open(context, extensionId);
  await call(setup, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(setup, 'wallet.lock', {});
  await setup.close();
}

test('a locked wallet opens on the unlock screen and the right password unlocks it', async ({
  context,
  extensionId,
}) => {
  await lockedWallet(context, extensionId);
  const page = await open(context, extensionId);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Wrong password.')).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  // Locking by hand: Settings → Lock wallet goes back to the unlock screen.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('five wrong passwords show the countdown and block the field', async ({
  context,
  extensionId,
}) => {
  await lockedWallet(context, extensionId);
  const page = await open(context, extensionId);
  for (let i = 0; i < 5; i++) {
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Unlock' }).click();
    if (i < 4) await expect(page.getByText('Wrong password.')).toBeVisible();
  }
  await expect(page.getByText(/Try again in 0:\d\d/)).toBeVisible();
  await expect(page.getByLabel('Password')).toBeDisabled();
});

test('the popup switches to the unlock screen when the full-lock alarm fires', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error('no service worker');
  await worker.evaluate(() => chrome.alarms.create('full-lock', { when: Date.now() + 500 }));
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
