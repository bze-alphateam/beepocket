import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeAuthInfo, decodeTxRaw, deriveAccount } from '@beepocket/core';
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
async function mockNode(context: BrowserContext): Promise<{ broadcasts: number; txs: string[] }> {
  const node = { broadcasts: 0, txs: [] as string[] };
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
        node.txs.push((route.request().postDataJSON() as { tx_bytes: string }).tx_bytes);
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
  const node = await mockNode(context);
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
    node,
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
    await expect(sign.getByRole('heading', { name: 'Approve', exact: true })).toBeVisible();
    await expect(sign.getByText(/1\.00 BZE/).first()).toBeVisible();
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
            (
              await chrome.runtime.sendMessage<unknown, { value: { state: string } }>({
                method: 'wallet.state',
                payload: {},
              })
            ).value.state,
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
    await sign
      .getByRole('checkbox', { name: 'I set this up myself and trust this address' })
      .check();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(dapp.getByRole('status')).toHaveText(`hash ${HASH.toLowerCase()}`);
  } finally {
    stop();
  }
});

test('a send plus an unknown message: one row each, Details over a footer that stays usable', async ({
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
    await expect(sign.getByRole('heading', { name: '2 actions' })).toBeVisible();
    await expect(sign.getByText('Both happen, or neither')).toBeVisible();
    const rows = sign.locator('ol .bp-sign-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveClass(/bp-sign-row-unknown/);
    await expect(rows.nth(1)).toContainText('MsgNothing');
    await expect(rows.nth(1)).toContainText("Can't read this message");
    // The raw message is one tap away, not on the screen.
    await expect(sign.locator('pre')).toHaveCount(0);
    await rows.nth(1).click();
    const details = sign.getByRole('dialog', { name: 'Details' });
    await expect(details.locator('pre')).toContainText('/test.v1.MsgNothing');
    // The sheet ends above the footer: Reject is still visible and works while it is open.
    const reject = sign.getByRole('button', { name: 'Reject' });
    await expect(reject).toBeVisible();
    const sheetBox = await details.boundingBox();
    const rejectBox = await reject.boundingBox();
    expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBeLessThanOrEqual(rejectBox?.y ?? 0);
    await reject.click();
    await expect(dapp.getByRole('status')).toHaveText('error rejected');
  } finally {
    stop();
  }
});

test('two sign requests share one window: 1 of 2, Next request, then the second', async ({
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
    await dapp.getByRole('button', { name: 'Send 1 BZE' }).click();
    await expect(sign.getByText('1 of 2')).toBeVisible();
    await sign.getByRole('button', { name: 'Approve' }).click();
    await expect(sign.getByText('Next request · 1 waiting')).toBeVisible();
    await expect(sign.getByRole('heading', { name: 'Approve', exact: true })).toBeVisible();
    await expect(sign.getByText('1 of 2')).toHaveCount(0);
    await sign.getByRole('button', { name: 'Reject' }).click();
    await expect(dapp.locator('#log li')).toHaveText([
      `hash ${HASH.toLowerCase()}`,
      'error rejected',
    ]);
  } finally {
    stop();
  }
});

test('closing the window answers every queued request rejected', async ({
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
    await dapp.getByRole('button', { name: 'Send 1 BZE' }).click();
    await expect(sign.getByText('1 of 2')).toBeVisible();
    await sign.close();
    await expect(dapp.locator('#log li')).toHaveText(['error rejected', 'error rejected']);
  } finally {
    stop();
  }
});

test('a fee the site set is pre-selected, labelled on the fee sheet and signed', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { dapp, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Pay with site fee' }).click(),
    ]);
    // The site's 5,000 ubze for 300,000 gas, not the wallet's 2,250 ubze for 225,000.
    const feeRow = sign.getByRole('button', { name: /Change fee token/ });
    await expect(feeRow).toContainText('0.005 BZE');
    await expect(sign.getByText(/higher than needed|too low/)).toHaveCount(0);
    await feeRow.click();
    const origin = new URL(dapp.url()).origin;
    await expect(sign.getByText(`Set by ${origin}`)).toBeVisible();
    await sign.getByRole('button', { name: /^BZE, ≈ 0\.005 BZE/ }).click();
    await sign.getByRole('button', { name: 'Approve' }).click();
    await expect(dapp.getByRole('status')).toHaveText(`hash ${HASH.toLowerCase()}`);
  } finally {
    stop();
  }
});

test('a site fee far above the estimate shows a warning', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { dapp, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Pay with high site fee' }).click(),
    ]);
    // 10,000 ubze against the wallet's own 2,250.
    await expect(sign.getByText('This site set a fee about 4× higher than needed')).toBeVisible();
    await sign.getByRole('button', { name: 'Reject' }).click();
    await expect(dapp.getByRole('status')).toHaveText('error rejected');
  } finally {
    stop();
  }
});

test('Advanced gas limit and price are signed and broadcast exactly as shown', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { dapp, node, stop } = await connectedDapp(context, extensionId);
  try {
    await dapp.getByLabel('Recipient').fill(RECIPIENT);
    const [sign] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Send 1 BZE' }).click(),
    ]);
    // 150,000 simulated: Auto is 225,000 gas. 300,000 gas at 3 × 0.01 ubze is 9,000 ubze.
    await sign.getByRole('button', { name: /Change fee token/ }).click();
    await sign.getByRole('button', { name: /^Advanced: gas limit and price/ }).click();
    await expect(sign.getByRole('textbox', { name: 'Gas limit' })).toHaveValue('225,000');
    await sign.getByRole('textbox', { name: 'Gas limit' }).fill('300000');
    await sign.getByRole('radio', { name: /^×3/ }).click();
    await expect(sign.locator('.bp-gas-fee')).toContainText('0.009 BZE');
    await sign.getByRole('button', { name: 'Done' }).click();

    const feeRow = sign.getByRole('button', { name: /Change fee token/ });
    await expect(feeRow).toContainText('Custom gas');
    await expect(feeRow).toContainText('0.009 BZE');
    await expect(sign.getByText('300,000 · custom')).toBeVisible();
    await expect(sign.getByText('0.03 ubze/gas · ×3')).toBeVisible();
    await sign.getByRole('button', { name: 'Approve' }).click();
    await expect(dapp.getByRole('status')).toHaveText(`hash ${HASH.toLowerCase()}`);

    const [tx] = node.txs;
    if (tx === undefined) throw new Error('nothing was broadcast');
    const { authInfoBytes } = decodeTxRaw(Uint8Array.from(Buffer.from(tx, 'base64')));
    expect(decodeAuthInfo(authInfoBytes).fee).toEqual({
      amount: [{ denom: 'ubze', amount: '9000' }],
      gasLimit: '300000',
      payer: '',
      granter: '',
    });
  } finally {
    stop();
  }
});
