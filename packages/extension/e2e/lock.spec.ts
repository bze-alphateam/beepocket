import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mockReply } from './mock-server';

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

test('"Forgot it?" then Back keeps the wallet; an import replaces it only once confirmed', async ({
  context,
  extensionId,
}) => {
  // Importing runs the real key derivation, which is slow on CI.
  test.setTimeout(120_000);
  await context.route(/^https:\/\/(rest|explorer)\.getbze\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const reply = mockReply(url.pathname + url.search);
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
  await lockedWallet(context, extensionId);
  const page = await open(context, extensionId);
  const unlockHeading = page.getByRole('heading', { name: 'Welcome back' });
  await expect(unlockHeading).toBeVisible();

  // Forgot → Back lands on the unlock screen again, and the old password still opens the wallet.
  await page.getByRole('button', { name: /Forgot it\?/ }).click();
  await expect(page.getByRole('heading', { name: 'Import recovery phrase' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(unlockHeading).toBeVisible();
  const kept = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'wallet.state', payload: {} }),
  );
  expect(kept).toMatchObject({ ok: true, value: { state: 'locked' } });

  // Forgot → import: the password step asks to confirm the deletion before anything is written.
  const phrase = `${'abandon '.repeat(11)}about`;
  await page.getByRole('button', { name: /Forgot it\?/ }).click();
  await page.getByLabel('Word 1', { exact: true }).evaluate((cell, text) => {
    const data = new DataTransfer();
    data.setData('text', text);
    cell.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, phrase);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password', { exact: true }).fill('another password');
  await page.getByLabel('Repeat password').fill('another password');
  await page.getByRole('button', { name: 'Continue' }).click();

  const replace = page.getByRole('button', { name: 'Delete and replace' });
  await expect(page.getByRole('alert')).toContainText(
    'Only its recovery phrase can bring it back.',
  );
  await expect(replace).toBeDisabled();
  // Cancel goes back to the password step; nothing was replaced.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Repeat password')).toBeVisible();
  const stillLocked = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'wallet.state', payload: {} }),
  );
  expect(stillLocked).toMatchObject({ ok: true, value: { state: 'locked' } });

  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByRole('checkbox', { name: 'I understand my current wallet will be deleted' })
    .click();
  await replace.click();
  await expect(page.getByRole('heading', { name: 'How do you want to start?' })).toBeVisible();
  const addresses = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'wallet.addresses', payload: {} }),
  );
  expect(addresses).toMatchObject({
    ok: true,
    value: { addresses: [{ index: 0, address: deriveAccount(phrase, 0).address }] },
  });
});
