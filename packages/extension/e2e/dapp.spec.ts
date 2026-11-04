import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startDappServer } from './mock-server';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const THIRD = deriveAccount(PHRASE, 2).address;

test.use({ actionTimeout: 10_000 });

async function call(page: Page, method: string, payload: unknown): Promise<void> {
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

/** A wallet with three addresses; the node knows nothing (balances are empty). */
async function walletWithAddresses(context: BrowserContext, extensionId: string): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/cosmos/bank/v1beta1/balances/')) {
      return route.fulfill({ json: { balances: [], pagination: { next_key: null, total: '0' } } });
    }
    return route.fulfill({ status: 404, json: { code: 5, message: 'not found', details: [] } });
  });
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(setup, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(setup, 'wallet.deriveNext', {});
  await call(setup, 'wallet.deriveNext', {});
  await setup.close();
}

async function openDapp(context: BrowserContext): Promise<{ dapp: Page; stop: () => void }> {
  const { server, url } = await startDappServer();
  const dapp = await context.newPage();
  await dapp.goto(url);
  return {
    dapp,
    stop: () => {
      server.close();
    },
  };
}

/** Clicks `Connect wallet` and returns the request window that opens. */
async function connect(context: BrowserContext, dapp: Page): Promise<Page> {
  const [request] = await Promise.all([
    context.waitForEvent('page'),
    dapp.getByRole('button', { name: 'Connect wallet' }).click(),
  ]);
  await expect.poll(() => request.url()).toContain('window=request');
  return request;
}

test('connects with the picked address, then getKey answers without a window', async ({
  context,
  extensionId,
}) => {
  // Creating the wallet runs the real key derivation, which is slow on CI.
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const { dapp, stop } = await openDapp(context);
  try {
    const request = await connect(context, dapp);
    await expect(request.getByText(new URL(dapp.url()).origin)).toBeVisible();
    await expect(request.getByText('Sees this address and its balances')).toBeVisible();
    await request.getByRole('radio', { name: /Address 3/ }).check();
    await request.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dapp.getByRole('status')).toHaveText(`address ${THIRD} name Address 3`);

    let opened = 0;
    context.on('page', () => {
      opened++;
    });
    await dapp.reload();
    await dapp.getByRole('button', { name: 'Get key' }).click();
    await expect(dapp.getByRole('status')).toHaveText(`address ${THIRD} name Address 3`);
    expect(opened).toBe(0);
  } finally {
    stop();
  }
});

test('Cancel answers rejected', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const { dapp, stop } = await openDapp(context);
  try {
    const request = await connect(context, dapp);
    await request.getByRole('button', { name: 'Cancel' }).click();
    await expect(dapp.getByRole('status')).toHaveText('error rejected');
  } finally {
    stop();
  }
});

test('the actions stay on screen when the title bar takes part of the window', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const { dapp, stop } = await openDapp(context);
  try {
    const request = await connect(context, dapp);
    // 600 px outer minus a 28 px macOS title bar.
    await request.setViewportSize({ width: 360, height: 572 });
    await expect(request.getByRole('heading', { name: 'Connection request' })).toBeVisible();
    await expect(request.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
    await expect(request.getByRole('button', { name: 'Connect', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await request.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dapp.getByRole('status')).toHaveText(/name Main$/);
  } finally {
    stop();
  }
});

test('the toolbar popup shows the waiting request with its actions in view', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const { dapp, stop } = await openDapp(context);
  try {
    await connect(context, dapp);
    // The popup page itself, at the toolbar popup's 360 × 600.
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'Connection request' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
    const approve = popup.getByRole('button', { name: 'Connect', exact: true });
    await expect(approve).toBeInViewport({ ratio: 1 });
    await approve.click();
    await expect(dapp.getByRole('status')).toHaveText(/name Main$/);
  } finally {
    stop();
  }
});

test('a fully locked wallet shows unlock first, then the connect screen', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const lockPage = await context.newPage();
  await lockPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(lockPage, 'wallet.lock', {});
  await lockPage.close();

  const { dapp, stop } = await openDapp(context);
  try {
    const request = await connect(context, dapp);
    await expect(request.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(request.getByRole('button', { name: /Forgot|Import/ })).toHaveCount(0);
    await request.getByLabel('Password').fill(PASSWORD);
    await request.getByRole('button', { name: 'Unlock' }).click();
    await expect(request.getByRole('heading', { name: 'Connection request' })).toBeVisible();
    await request.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dapp.getByRole('status')).toHaveText(/^address bze1\w+ name Main$/);
  } finally {
    stop();
  }
});

test('Settings › Connected sites: Change pushes accountChanged, Disconnect makes getKey fail', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const { dapp, stop } = await openDapp(context);
  try {
    await dapp.evaluate(() => {
      const w = window as unknown as { changes: number };
      w.changes = 0;
      window.addEventListener('beepocket_keystorechange', () => {
        w.changes++;
      });
    });
    const request = await connect(context, dapp);
    await request.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dapp.getByRole('status')).toHaveText(/name Main$/);

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/popup.html`);
    await settings.getByRole('button', { name: 'Settings' }).click();
    await settings.getByRole('button', { name: /Connected sites · 1/ }).click();
    // One compact row: the whole origin, the address it sees, the browser's icon for the site.
    await expect(settings.getByText('Mainnet · 1')).toBeVisible();
    const row = settings.locator('.bp-sites-list .bp-site-row');
    await expect(row.locator('.bp-site-row-domain')).toHaveText(new URL(dapp.url()).origin);
    await expect(row.locator('.bp-site-row-who')).toContainText('Main · bze1');
    await expect(row.locator('img')).toHaveAttribute('src', /\/_favicon\/\?pageUrl=/);
    await settings.getByRole('button', { name: /^Change the address/ }).click();
    await settings.getByRole('radio', { name: /Address 3/ }).check();
    await settings.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(() => dapp.evaluate(() => (window as unknown as { changes: number }).changes))
      .toBe(1);
    // interchain-kit's wallet saw it too.
    await expect(dapp.locator('#account-changes')).toHaveText('1');
    await dapp.getByRole('button', { name: 'Get key' }).click();
    await expect(dapp.getByRole('status')).toHaveText(`address ${THIRD} name Address 3`);

    await settings.getByRole('button', { name: /^Disconnect http/ }).click();
    await expect
      .poll(() => dapp.evaluate(() => (window as unknown as { changes: number }).changes))
      .toBe(2);
    await expect(dapp.locator('#account-changes')).toHaveText('2');
    await dapp.getByRole('button', { name: 'Get key' }).click();
    await expect(dapp.getByRole('status')).toHaveText('error not-connected');
  } finally {
    stop();
  }
});

test('a fully locked wallet shows the waiting card in the popup; unlocking there continues the request', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await walletWithAddresses(context, extensionId);
  const lockPage = await context.newPage();
  await lockPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(lockPage, 'wallet.lock', {});
  const { dapp, stop } = await openDapp(context);
  try {
    const request = await connect(context, dapp);
    await expect(request.getByLabel('Password')).toBeVisible();

    await lockPage.reload();
    await expect(lockPage.getByText(/is waiting/)).toBeVisible();
    await expect(lockPage.getByText('It stays connected.')).toBeVisible();
    await lockPage.getByLabel('Password').fill(PASSWORD);
    await lockPage.getByRole('button', { name: 'Unlock' }).click();
    // The popup continues to the request in place.
    await expect(lockPage.getByRole('heading', { name: 'Connection request' })).toBeVisible();
    await expect(request.getByRole('heading', { name: 'Connection request' })).toBeVisible();
  } finally {
    stop();
  }
});
