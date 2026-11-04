import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeAuthInfo, decodeTxRaw, deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const MAIN = deriveAccount(PHRASE, 0).address;
const CONTACT = deriveAccount(PHRASE, 7).address;
const HASH = 'AB'.repeat(32);

const fixture = (name: string): unknown =>
  (
    JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, `../../core/test/fixtures/rest/mainnet/${name}.json`),
        'utf8',
      ),
    ) as { body: unknown }
  ).body;

interface Node {
  broadcasts: number;
  /** The `tx_bytes` of every broadcast, base64. */
  txs: string[];
  /** The raw log the next broadcast is rejected with; null accepts it. */
  reject: string | null;
}

/** Plays a BZE node: the main address holds 100 BZE, simulation costs 150,000 gas. */
async function mockNode(context: BrowserContext): Promise<Node> {
  const node: Node = { broadcasts: 0, txs: [], reject: null };
  await context.route('https://rest.getbze.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
      case '/cosmos/tx/v1beta1/txs': {
        node.broadcasts++;
        node.txs.push((request.postDataJSON() as { tx_bytes: string }).tx_bytes);
        const code = node.reject === null ? 0 : 13;
        return route.fulfill({
          json: {
            tx_response: {
              height: '0',
              txhash: HASH,
              codespace: code === 0 ? '' : 'sdk',
              code,
              data: '',
              raw_log: node.reject ?? '[]',
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
      }
      case `/cosmos/tx/v1beta1/txs/${HASH}`:
        return route.fulfill({
          json: {
            tx_response: {
              height: '12',
              txhash: HASH,
              code: 0,
              raw_log: '[]',
              gas_used: '120000',
              gas_wanted: '195000',
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

async function openSend(
  context: BrowserContext,
  extensionId: string,
  review = true,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(page, 'book.add', { name: 'Alex', address: CONTACT });
  await page.reload();
  await page.getByRole('button', { name: 'Send BZE', exact: true }).click();
  await page.getByRole('button', { name: 'Open address book' }).click();
  await page.getByRole('button', { name: 'Choose Alex' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'address book' })).toContainText('Alex');
  await page.getByRole('textbox', { name: 'Amount' }).fill('1');
  if (review) await page.getByRole('button', { name: 'Review', exact: true }).click();
  return page;
}

test.use({ actionTimeout: 10_000 });

test('sends BZE to a contact and shows success', async ({ context, extensionId }) => {
  // Creating the wallet runs the real key derivation, which is slow on CI.
  test.setTimeout(90_000);
  const node = await mockNode(context);
  const page = await openSend(context, extensionId);

  await expect(page.getByText(CONTACT)).toBeVisible();
  await expect(page.getByText("A sent transaction can't be undone")).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible();
  expect(node.broadcasts).toBe(1);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Send BZE', exact: true })).toBeVisible();
});

test("shows the node's message when the fee is too low and Try again works", async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const node = await mockNode(context);
  node.reject = 'insufficient fee; got: 1ubze required: 1950ubze';
  const page = await openSend(context, extensionId);

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByRole('heading', { name: 'Send failed' })).toBeVisible();
  await expect(page.getByText('insufficient fee; got: 1ubze required: 1950ubze')).toBeVisible();

  node.reject = null;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible();
  expect(node.broadcasts).toBe(2);
});

test('sends with an Advanced gas limit and price, signed exactly as reviewed', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const node = await mockNode(context);
  const page = await openSend(context, extensionId, false);

  // 150,000 simulated: Auto is 180,000 gas. 300,000 gas at 2 × 0.01 ubze is 6,000 ubze.
  const feeRow = page.getByRole('button', { name: /^Network fee about/ });
  await expect(feeRow).toContainText('0.0018 BZE');
  await feeRow.click();
  await page.getByRole('button', { name: /^Advanced: gas limit and price/ }).click();
  const gas = page.getByRole('textbox', { name: 'Gas limit' });
  await expect(gas).toHaveValue('180,000');
  await gas.fill('100000');
  await expect(page.getByText('At least 150,000, the gas the simulation used.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
  await gas.fill('300000');
  await page.getByRole('radio', { name: /^×2/ }).click();
  await expect(page.locator('.bp-gas-fee')).toContainText('0.006 BZE');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(feeRow).toContainText('Custom gas');
  await expect(feeRow).toContainText('0.006 BZE');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByText('300,000 · custom')).toBeVisible();
  await expect(page.getByText('0.02 ubze/gas · ×2')).toBeVisible();
  await expect(page.getByText('1.006 BZE')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByRole('heading', { name: 'Sent' })).toBeVisible();

  const [tx] = node.txs;
  if (tx === undefined) throw new Error('nothing was broadcast');
  const { authInfoBytes } = decodeTxRaw(Uint8Array.from(Buffer.from(tx, 'base64')));
  expect(decodeAuthInfo(authInfoBytes).fee).toEqual({
    amount: [{ denom: 'ubze', amount: '6000' }],
    gasLimit: '300000',
    payer: '',
    granter: '',
  });
});
