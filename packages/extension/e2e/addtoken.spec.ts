import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { test as lateTest } from './late-install';
import { mockFactoryDenom, mockReply } from './mock-server';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const PAGE_HTML = readFileSync(resolve(import.meta.dirname, 'addtoken/index.html'), 'utf8');
const LINK = (from?: string) =>
  `https://getbze.com/wallet/add/?code=${encodeURIComponent(mockFactoryDenom)}${
    from === undefined ? '' : `&from=${encodeURIComponent(from)}`
  }`;

/** The node and Scan hosts answer from the recorded mocks; getbze.com serves a tiny add page. */
async function route(context: BrowserContext): Promise<void> {
  await context.route(/^https:\/\/(rest|explorer)\.getbze\.com\//, async (r) => {
    const url = new URL(r.request().url());
    const reply = mockReply(url.pathname + url.search);
    await r.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
  await context.route('https://getbze.com/wallet/add/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: PAGE_HTML }),
  );
}

async function call(page: Page, method: string, payload: unknown): Promise<void> {
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

/** Opens the add page and returns it with the wallet window it caused. */
async function openLink(context: BrowserContext, url: string): Promise<{ page: Page; win: Page }> {
  const page = await context.newPage();
  const [win] = await Promise.all([context.waitForEvent('page'), page.goto(url)]);
  await expect.poll(() => win.url()).toContain('window=add-token');
  return { page, win };
}

test('the link opens the Add screen, Add selects the token, a second link says Open', async ({
  context,
  extensionId,
}) => {
  // Creating the wallet runs the real key derivation, which is slow on CI.
  test.setTimeout(120_000);
  await route(context);
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(setup, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await setup.close();

  const first = await openLink(context, LINK());
  await expect(first.win.getByRole('heading', { name: 'Add a token' })).toBeVisible();
  await expect(first.win.getByText('A link sent you here')).toBeVisible();
  await expect(first.win.getByText('Gold Coin')).toBeVisible();
  await expect(
    first.win.getByText('Anyone can make a token. Add it only if you trust them.'),
  ).toBeVisible();
  await expect(first.page.locator('#state')).toHaveText('opened');
  await first.win.getByRole('button', { name: 'Add GOLD' }).click();
  await expect(first.win.getByText('GOLD added')).toBeVisible();
  await expect(first.win.locator('.bp-home-token')).toContainText('GOLD');

  await first.win.close();
  await first.page.close();
  const second = await openLink(context, LINK());
  await expect(second.win.getByRole('button', { name: 'Open GOLD' })).toBeVisible();
  await expect(second.page.locator('#state')).toHaveText('opened');
  await second.win.getByRole('button', { name: 'Open GOLD' }).click();
  await expect(second.win.locator('.bp-home-token')).toContainText('GOLD');
  await expect(second.win.getByText('GOLD added')).toHaveCount(0);
});

lateTest(
  'a tab opened before the install gets onboarding with the code filled in',
  async ({ context, install }) => {
    await route(context);
    const page = await context.newPage();
    await page.goto(LINK('https://dex.getbze.com'));
    await expect(page.locator('#state')).toHaveText('waiting');

    const [win] = await Promise.all([context.waitForEvent('page'), install()]);
    await expect.poll(() => win.url()).toContain('window=onboarding');
    await expect(win.getByText('Setting up for GOLD · Link from dex.getbze.com')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Create a new wallet' })).toBeVisible();
  },
);
