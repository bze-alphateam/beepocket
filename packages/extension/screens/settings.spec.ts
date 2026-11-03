import type { BrowserContext, Page } from '@playwright/test';
import { startDappServer } from '../e2e/mock-server';
import { expect, openPopup, PASSWORD, reload, seedWallet, shot, test } from './support';

// The Settings sheet over Home and what it opens: lock timers, address book, recovery phrase,
// preferred tokens, the testnet landing and Connected sites (W-Settings, W-Sites*, W-Light-*).

const sheet = (page: Page, name: string) => page.getByRole('dialog', { name });

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(sheet(page, 'Settings').getByText('Lock wallet')).toBeVisible();
}

/** Connects a test dapp served on its own port, with the address `label`. */
async function connectSite(context: BrowserContext, label: string): Promise<() => void> {
  const { server, url } = await startDappServer();
  const dapp = await context.newPage();
  await dapp.goto(url);
  const [win] = await Promise.all([
    context.waitForEvent('page'),
    dapp.getByRole('button', { name: 'Connect wallet' }).click(),
  ]);
  await win.getByRole('radio', { name: new RegExp(label) }).click();
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dapp.getByRole('status')).toHaveText(new RegExp(`name ${label}$`));
  await dapp.close();
  return () => {
    server.close();
  };
}

test('settings sheet, lock timers, address book, recovery phrase', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(240_000);
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  await reload(page, '12,480.52');

  await openSettings(page);
  await shot(page, 'settings-sheet');
  await sheet(page, 'Settings')
    .locator('.bp-sheet-body')
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await shot(page, 'settings-sheet-end');

  await page.getByRole('button', { name: /^Lock timers/ }).click();
  await expect(sheet(page, 'Lock timers')).toBeVisible();
  await shot(page, 'settings-timers');
  await page.getByRole('button', { name: /^Lock sending after, now/ }).click();
  await expect(sheet(page, 'Lock sending after')).toBeVisible();
  await shot(page, 'settings-timers-pick');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Address book/ }).click();
  await expect(sheet(page, 'Address book').getByText('Alex')).toBeVisible();
  await shot(page, 'settings-book');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Show recovery phrase/ }).click();
  await expect(sheet(page, 'Recovery phrase').getByLabel('Password')).toBeVisible();
  await shot(page, 'settings-reveal-password');
  await sheet(page, 'Recovery phrase').getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reveal phrase/ })).toBeVisible();
  await shot(page, 'settings-reveal');
  await page.getByRole('button', { name: /Reveal phrase/ }).click();
  await expect(page.locator('.bp-words li', { hasText: 'abandon' }).first()).toBeVisible();
  await shot(page, 'settings-reveal-words');
  await page.getByRole('button', { name: 'Hide' }).click();

  await page.getByRole('button', { name: /^Preferred tokens/ }).click();
  await expect(page.getByRole('checkbox', { name: /PAGE/ })).toBeVisible();
  await shot(page, 'settings-tokens');
});

test('testnet: the toggle and the landing of a network without tokens', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(240_000);
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  await reload(page, '12,480.52');
  await openSettings(page);
  await page.getByRole('switch', { name: /Testnet/ }).click();
  await expect(page.getByText('No tokens are picked on Testnet yet.')).toBeVisible();
  await shot(page, 'settings-tokens-landing');
});

test('connected sites: list, change, empty', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  const stops = [
    await connectSite(context, 'Main'),
    await connectSite(context, 'Savings'),
    await connectSite(context, 'Main'),
  ];
  try {
    await reload(page, '12,480.52');
    await openSettings(page);
    await page.getByRole('button', { name: /Connected sites · 3/ }).click();
    await expect(page.getByText('Each site sees one address.', { exact: false })).toBeVisible();
    await shot(page, 'sites');
    await page
      .getByRole('button', { name: /^Change the address/ })
      .nth(1)
      .click();
    await expect(page.getByRole('radiogroup')).toBeVisible();
    await shot(page, 'sites-change');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Disconnect all sites' }).click();
    await expect(page.getByText('No connected sites')).toBeVisible();
    await shot(page, 'sites-empty');
  } finally {
    for (const stop of stops) stop();
  }
});
