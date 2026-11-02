import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import {
  ADDRESSES,
  call,
  CONTACTS,
  expect,
  openPopup,
  PAGE,
  PASSWORD,
  PHRASE,
  reload,
  seedWallet,
  shot,
  test,
} from './support';

// The send flow: form, From / fee / address book sheets, Review, pending and the results.

const HASH = '7F3A9C'.padEnd(58, '0') + 'E21B4D';
const ALEX = CONTACTS[0]?.address ?? '';
/** A valid address that is in no address book. */
const STRANGER = deriveAccount(PHRASE, 12).address;
const OUT_OF_GAS = 'out of gas in location: WriteFlat; gasWanted: 98000, gasUsed: 101245';

interface Node {
  /** The raw log the next broadcast is rejected with; null accepts it. */
  reject: string | null;
  /** Leaves the transaction lookup unanswered, so the flow stays on Pending. */
  hold: boolean;
}

/**
 * The parts of a node a send needs, over the walker's read-only mock: accounts, simulation,
 * broadcast, the transaction lookup, and a BZE / PAGE pool so PAGE can pay the fee.
 */
async function mockSendNode(context: BrowserContext): Promise<Node> {
  const node: Node = { reject: null, hold: false };
  await context.route('https://rest.getbze.com/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const account = /\/cosmos\/auth\/v1beta1\/accounts\/(.+)$/.exec(path);
    if (account?.[1] !== undefined) {
      return route.fulfill({
        json: {
          account: {
            '@type': '/cosmos.auth.v1beta1.BaseAccount',
            address: decodeURIComponent(account[1]),
            pub_key: null,
            account_number: '7',
            sequence: '0',
          },
        },
      });
    }
    switch (path) {
      case '/bze/tradebin/all_liquidity_pools':
        return route.fulfill({
          json: {
            list: [
              {
                id: `ubze_${PAGE}`,
                base: 'ubze',
                quote: PAGE,
                lp_denom: 'ulp/page',
                creator: ADDRESSES[0]?.address,
                fee: '0.002000000000000000',
                fee_dest: { treasury: '0.25', burner: '0.25', providers: '0.5' },
                reserve_base: '500000000000',
                reserve_quote: '35000000000',
                stable: false,
              },
            ],
            pagination: { next_key: null, total: '1' },
          },
        });
      case '/cosmos/tx/v1beta1/simulate':
        return route.fulfill({ json: { gas_info: { gas_wanted: '0', gas_used: '150000' } } });
      case '/cosmos/tx/v1beta1/txs': {
        const code = node.reject === null ? 0 : 11;
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
        // A route never answered keeps the request open: the screen waits on Pending.
        if (node.hold) return new Promise<void>(() => undefined);
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
        return route.fallback();
    }
  });
  return node;
}

interface Start {
  /** The token to send; PAGE is put first in the preferred list so Home opens on it. */
  symbol?: 'BZE' | 'PAGE';
  /** Lets the weak-lock alarm fire before the flow opens. */
  weakLock?: boolean;
}

/** The full data set, unlocked, on the Send form of `symbol`. */
async function startSend(
  context: BrowserContext,
  extensionId: string,
  { symbol = 'BZE', weakLock = false }: Start = {},
): Promise<{ page: Page; node: Node }> {
  const page = await openPopup(context, extensionId);
  const node = await mockSendNode(context);
  await seedWallet(page);
  if (symbol === 'PAGE') {
    await call(page, 'tokens.remove', { denom: 'ubze' });
    await call(page, 'tokens.add', { denom: 'ubze' });
  }
  await call(page, 'wallet.unlock', { password: PASSWORD });
  if (weakLock) {
    await page.evaluate(() => chrome.alarms.create('weak-lock', { when: Date.now() + 200 }));
    await expect(async () => {
      const res = (await call(page, 'wallet.state')) as { value: { state: string } };
      expect(res.value.state).toBe('weakLocked');
    }).toPass();
  }
  await reload(page, 'Main');
  await page
    .getByRole('button', { name: `Send ${symbol}`, exact: true })
    .first()
    .click();
  await page.getByRole('textbox', { name: 'To' }).waitFor();
  return { page, node };
}

/** Fills To and Amount and waits for the form's fee estimate. */
async function fill(page: Page, to: string, amount = '250'): Promise<void> {
  await page.getByRole('textbox', { name: 'To' }).fill(to);
  await page.getByRole('textbox', { name: 'Amount' }).fill(amount);
  await page.getByRole('button', { name: /^Network fee about/ }).waitFor();
}

async function review(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByText('You send').waitFor();
}

async function pickFee(page: Page, symbol: string): Promise<void> {
  await page.getByRole('button', { name: /^Network fee about/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${symbol}, `) }).click();
  await page
    .getByRole('button', { name: new RegExp(`^Network fee about .* ${symbol}\\.`) })
    .waitFor();
}

test.describe.configure({ timeout: 180_000 });

test('send form, from sheet and from row', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId);
  await fill(page, ALEX);
  await page.getByRole('status').filter({ hasText: 'address book' }).waitFor();
  await shot(page, 'send-form');

  await page.getByRole('button', { name: /^From Main/ }).click();
  await page.getByRole('dialog', { name: 'Send from' }).waitFor();
  await shot(page, 'send-from-sheet');

  await page.getByRole('button', { name: /^Savings, / }).click();
  await page.getByRole('textbox', { name: 'To' }).fill('');
  await page.getByRole('textbox', { name: 'Amount' }).fill('');
  await page.getByRole('button', { name: /^From Savings/ }).waitFor();
  await shot(page, 'send-from-row');
});

test('unknown recipient and new contact', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId);
  await fill(page, STRANGER);
  await page.getByText('Not in your address book').waitFor();
  await shot(page, 'send-unknown');

  await page.getByRole('button', { name: 'Save it' }).click();
  await page.getByRole('dialog', { name: 'New contact' }).waitFor();
  await page.getByRole('textbox', { name: 'Name' }).fill('Radu (OTC)');
  await shot(page, 'send-contact-new');
});

test('address book and search', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId);
  await page.getByRole('textbox', { name: 'To' }).fill(ALEX);
  await page.getByRole('button', { name: 'Open address book' }).click();
  await page.getByRole('button', { name: 'Choose Alex' }).waitFor();
  await shot(page, 'send-book');

  await page.getByRole('searchbox', { name: 'Search address book' }).fill('ex');
  await page.getByRole('button', { name: 'Choose Maria' }).waitFor({ state: 'detached' });
  await shot(page, 'send-book-search');
});

test('fee sheet on a PAGE send', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId, { symbol: 'PAGE' });
  await fill(page, ALEX);
  await page.getByRole('button', { name: /^Network fee about/ }).click();
  await page.getByRole('dialog', { name: 'Pay network fee with' }).waitFor();
  await shot(page, 'send-fee-page');
});

test('review, paid in BZE and in another token', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId);
  await fill(page, ALEX);
  await review(page);
  await shot(page, 'send-review');

  await page.getByRole('button', { name: 'Edit' }).click();
  await pickFee(page, 'PAGE');
  await review(page);
  await shot(page, 'send-review-fee');
});

test('review of a PAGE send', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId, { symbol: 'PAGE' });
  await fill(page, ALEX);
  await review(page);
  await shot(page, 'send-review-page');
});

test('review in the weak lock', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId, { weakLock: true });
  await fill(page, ALEX);
  await review(page);
  await page.getByLabel('Enter your password to sign').waitFor();
  await shot(page, 'send-review-locked');
});

test('pending', async ({ context, extensionId }) => {
  const { page, node } = await startSend(context, extensionId);
  await fill(page, ALEX);
  await review(page);
  node.hold = true;
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await page.getByRole('heading', { name: /^Sending/ }).waitFor();
  await shot(page, 'send-pending');
});

test('success', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId);
  await fill(page, ALEX);
  await review(page);
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await page.getByRole('heading', { name: 'Sent' }).waitFor();
  await shot(page, 'send-success');
});

test('success of a PAGE send', async ({ context, extensionId }) => {
  const { page } = await startSend(context, extensionId, { symbol: 'PAGE' });
  await fill(page, ALEX);
  await review(page);
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await page.getByRole('heading', { name: 'Sent' }).waitFor();
  await shot(page, 'send-success-page');
});

test('failed: the node rejects the broadcast', async ({ context, extensionId }) => {
  const { page, node } = await startSend(context, extensionId);
  node.reject = OUT_OF_GAS;
  await fill(page, ALEX);
  await review(page);
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await page.getByRole('heading', { name: 'Send failed' }).waitFor();
  await shot(page, 'send-failed');
});

test('failed PAGE send', async ({ context, extensionId }) => {
  const { page, node } = await startSend(context, extensionId, { symbol: 'PAGE' });
  node.reject = OUT_OF_GAS;
  await fill(page, ALEX);
  await review(page);
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await page.getByRole('heading', { name: 'Send failed' }).waitFor();
  await shot(page, 'send-failed-page');
});
