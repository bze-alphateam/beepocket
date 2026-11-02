import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startDappServer } from './mock-server';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const MAIN = deriveAccount(PHRASE, 0).address;
const RECIPIENT = deriveAccount(PHRASE, 1).address;
const HASH = 'AB'.repeat(32);

test.use({ actionTimeout: 10_000 });

const fixture = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, `../../core/test/fixtures/rest/mainnet/${name}.json`),
        'utf8',
      ),
    ) as { body: unknown }
  ).body;

/** Plays a BZE node: the main address holds 100 BZE (account 7, sequence 0), gas costs 150,000. */
async function mockNode(context: BrowserContext): Promise<{ broadcasts: number }> {
  const node = { broadcasts: 0 };
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const notFound = { status: 404, json: { code: 5, message: 'not found', details: [] } };
    if (url.pathname.startsWith('/cosmos/bank/v1beta1/balances/')) {
      const mine = decodeURIComponent(url.pathname.split('/').pop() ?? '') === MAIN;
      const coins = mine ? [{ denom: 'ubze', amount: '100000000' }] : [];
      return route.fulfill({
        json: { balances: coins, pagination: { next_key: null, total: String(coins.length) } },
      });
    }
    if (url.pathname.startsWith('/cosmos/auth/v1beta1/accounts/')) {
      return route.fulfill({
        json: {
          account: {
            '@type': '/cosmos.auth.v1beta1.BaseAccount',
            address: MAIN,
            pub_key: null,
            account_number: '7',
            sequence: '0',
          },
        },
      });
    }
    switch (url.pathname) {
      case '/bze/txfeecollector/params':
        return route.fulfill({ json: fixture('fee-params') });
      case '/bze/tradebin/params':
        return route.fulfill({ json: fixture('tradebin-params') });
      case '/bze/tradebin/all_liquidity_pools':
        return route.fulfill({ json: { list: [], pagination: { next_key: null, total: '0' } } });
      case '/bze/tradebin/halted_denoms':
        return route.fulfill({ json: { denoms: [], pagination: { next_key: null, total: '0' } } });
      case '/cosmos/tx/v1beta1/simulate':
        return route.fulfill({ json: { gas_info: { gas_wanted: '0', gas_used: '150000' } } });
      case '/cosmos/tx/v1beta1/txs':
        node.broadcasts++;
        return route.fulfill({
          json: {
            tx_response: {
              height: '0',
              txhash: HASH,
              codespace: '',
              code: 0,
              data: '',
              raw_log: '[]',
              logs: [],
              info: '',
              gas_wanted: '0',
              gas_used: '0',
              tx: null,
              timestamp: '',
              events: [],
            },
          },
        });
      default:
        return route.fulfill(notFound);
    }
  });
  return node;
}

async function call(page: Page, method: string, payload: unknown): Promise<void> {
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

/** A wallet that is connected to the test dapp, with the dapp open. */
async function connectedDapp(context: BrowserContext, extensionId: string) {
  await mockNode(context);
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(setup, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  const { server, url } = await startDappServer();
  const dapp = await context.newPage();
  await dapp.goto(url);
  const [connect] = await Promise.all([
    context.waitForEvent('page'),
    dapp.getByRole('button', { name: 'Connect wallet' }).click(),
  ]);
  await connect.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dapp.getByRole('status')).toHaveText(/^address bze1\w+ name Main$/);
  return {
    dapp,
    setup,
    stop: () => {
      server.close();
    },
  };
}

test('signs and sends 1 BZE: sign screen, Approve, then the hash from the node', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { dapp, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Send 1 BZE' }).click(),
    ]);
    await expect(sign.getByRole('heading', { name: 'Approve a transaction' })).toBeVisible();
    await expect(sign.getByText(/1 BZE/).first()).toBeVisible();
    await sign.getByRole('button', { name: 'Approve' }).click();
    await expect(dapp.getByRole('status')).toHaveText(`hash ${HASH.toLowerCase()}`);
  } finally {
    stop();
  }
});

test('Reject answers rejected and broadcasts nothing', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { dapp, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Send 1 BZE' }).click(),
    ]);
    await sign.getByRole('button', { name: 'Reject' }).click();
    await expect(dapp.getByRole('status')).toHaveText('error rejected');
  } finally {
    stop();
  }
});

test('in the weak lock the sign screen goes through Unlock and approve', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { dapp, setup, stop } = await connectedDapp(context, extensionId);
  try {
    // The weak-lock alarm firing is what locks the wallet lightly.
    await setup.evaluate(() => chrome.alarms.create('weak-lock', { when: Date.now() + 200 }));
    await expect
      .poll(async () =>
        setup.evaluate(
          async (): Promise<string> =>
            ((await chrome.runtime.sendMessage({ method: 'wallet.state', payload: {} })) as {
              value: { state: string };
            }).value.state,
        ),
      )
      .toBe('weakLocked');

    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Send 1 BZE' }).click(),
    ]);
    await expect(sign.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await sign.getByLabel('Password').fill(PASSWORD);
    await sign.getByRole('button', { name: 'Unlock and approve' }).click();
    await expect(dapp.getByRole('status')).toHaveText(`hash ${HASH.toLowerCase()}`);
  } finally {
    stop();
  }
});

test('a MsgGrant shows the red sign screen and Approve waits for the tick', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { dapp, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Grant authz to address 2' }).click(),
    ]);
    const approve = sign.getByRole('button', { name: 'Approve' });
    await expect(sign.getByRole('alert')).toContainText('power over your address');
    await expect(approve).toHaveClass(/bp-btn-danger/);
    await expect(approve).toBeDisabled();
    await sign.getByLabel('I set this up myself and trust this address').check();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(dapp.getByRole('status')).toHaveText(`hash ${HASH.toLowerCase()}`);
  } finally {
    stop();
  }
});

test('a send plus an unknown message shows two cards, the second with its raw JSON', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { dapp, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Send + unknown message' }).click(),
    ]);
    await expect(sign.getByText('Signed together: both happen, or neither does')).toBeVisible();
    const cards = sign.locator('.bp-dapp-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('1 of 2');
    await expect(cards.nth(1)).toContainText('2 of 2');
    await expect(cards.nth(1)).toContainText("can't put this message in plain words");
    await expect(cards.nth(1).locator('.bp-dapp-raw')).toContainText('/test.v1.MsgNothing');
    await sign.getByRole('button', { name: 'Reject' }).click();
    await expect(dapp.getByRole('status')).toHaveText('error rejected');
  } finally {
    stop();
  }
});
