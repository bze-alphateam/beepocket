import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { MsgCancelOrder, MsgCreateOrder, MsgMultiSwap } from '../../core/src/proto/bze/tradebin/tx';
import { startDappServer } from '../e2e/mock-server';
import {
  ADDRESSES,
  call,
  expect,
  openPopup,
  PAGE,
  PASSWORD,
  PHRASE,
  seedWallet,
  shot,
  test,
} from './support';

// The windows a website opens: connect, sign (every kind on the canvas) and add a token. They are
// driven through the e2e test dapp, which asks the way the BZE dapps do.

const HASH = '7F3A9C'.padEnd(58, '0') + 'E21B4D';
const MAIN = ADDRESSES[0]?.address ?? '';
/** The address a grant gives power to: in no address book. */
const GRANTEE = deriveAccount(PHRASE, 12).address;
const MARKET = `ubze/${PAGE}`;

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const swap = (): [string, string] => [
  '/bze.tradebin.MsgMultiSwap',
  hex(
    MsgMultiSwap.encode({
      creator: MAIN,
      routes: [`ubze_${PAGE}`],
      input: { denom: 'ubze', amount: '1000000000' },
      minOutput: { denom: PAGE, amount: '68200000' },
    }).finish(),
  ),
];
const sellOrder = (price: string): [string, string] => [
  '/bze.tradebin.MsgCreateOrder',
  hex(
    MsgCreateOrder.encode({
      creator: MAIN,
      orderType: 'sell',
      amount: '500000000',
      price,
      marketId: MARKET,
    }).finish(),
  ),
];
const cancelOrder = (): [string, string] => [
  '/bze.tradebin.MsgCancelOrder',
  hex(
    MsgCancelOrder.encode({
      creator: MAIN,
      marketId: MARKET,
      orderId: '42',
      orderType: 'sell',
    }).finish(),
  ),
];
/** A message type BeePocket has never heard of. */
const unknown = (): [string, string] => ['/cosmwasm.wasm.v1.MsgExecuteContract', '0a03616263'];

/**
 * Over the walker's read-only node: accounts, simulation, broadcast, the BZE / PAGE pool and
 * market (so PAGE can pay the fee and swaps and orders read as pairs) and one open sell order.
 */
async function mockSignNode(context: BrowserContext): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
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
                creator: MAIN,
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
      case '/bze/tradebin/all_markets':
        return route.fulfill({
          json: {
            market: [{ base: 'ubze', quote: PAGE, creator: MAIN }],
            pagination: { next_key: null, total: '1' },
          },
        });
      case '/bze/tradebin/market_order':
        return route.fulfill({
          json: {
            order: {
              id: '42',
              market_id: MARKET,
              order_type: 'sell',
              amount: '500000000',
              price: '0.320000000000000000',
              owner: MAIN,
            },
          },
        });
      case '/cosmos/tx/v1beta1/simulate':
        return route.fulfill({ json: { gas_info: { gas_wanted: '0', gas_used: '150000' } } });
      case '/cosmos/tx/v1beta1/txs':
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
        return route.fallback();
    }
  });
}

interface Rig {
  popup: Page;
  dapp: Page;
  stop: () => void;
}

/** The seeded wallet, the node and the test dapp open in a tab. */
async function setUp(context: BrowserContext, extensionId: string): Promise<Rig> {
  const popup = await openPopup(context, extensionId);
  await mockSignNode(context);
  await seedWallet(popup);
  const { server, url } = await startDappServer();
  const dapp = await context.newPage();
  await dapp.goto(url);
  return {
    popup,
    dapp,
    stop: () => {
      server.close();
    },
  };
}

/** Runs `ask` on the dapp and returns the request window it opens, at 360 × 600. */
async function request(context: BrowserContext, ask: () => Promise<unknown>): Promise<Page> {
  const [win] = await Promise.all([context.waitForEvent('page'), ask()]);
  await win.setViewportSize({ width: 360, height: 600 });
  return win;
}

/** Connects the dapp with Main, so it may ask for signatures. */
async function connect(context: BrowserContext, dapp: Page): Promise<void> {
  const win = await request(context, () =>
    dapp.getByRole('button', { name: 'Connect wallet' }).click(),
  );
  await win.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dapp.getByRole('status')).toHaveText(/^address bze1\w+ name Main$/);
}

const sign = (dapp: Page, messages: [string, string][]) =>
  dapp.evaluate((m) => {
    (window as unknown as { signMessages: (m: [string, string][]) => void }).signMessages(m);
  }, messages);

/** Rejects what the window shows and waits until it is gone. */
async function reject(win: Page): Promise<void> {
  await Promise.all([
    win.waitForEvent('close'),
    win.getByRole('button', { name: 'Reject' }).click(),
  ]);
}

test('connect: list, picked, other kit', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const rig = await setUp(context, extensionId);
  try {
    const win = await request(context, () =>
      rig.dapp.getByRole('button', { name: 'Connect wallet' }).click(),
    );
    await expect(win.getByText('12,480.52 BZE')).toBeVisible();
    await shot(win, 'dapp-connect');
    await win.getByRole('radio', { name: /Trading/ }).click();
    await shot(win, 'dapp-connect-picked');
    await Promise.all([
      win.waitForEvent('close'),
      win.getByRole('button', { name: 'Cancel' }).click(),
    ]);

    // The same request in PAGE's kit: PAGE is the first preferred token.
    await call(rig.popup, 'tokens.remove', { denom: 'ubze' });
    await call(rig.popup, 'tokens.add', { denom: 'ubze' });
    const page = await request(context, () =>
      rig.dapp.getByRole('button', { name: 'Connect wallet' }).click(),
    );
    await expect(page.getByText(/PAGE$/).first()).toBeVisible();
    await shot(page, 'dapp-connect-new');
  } finally {
    rig.stop();
  }
});

test('connected: the answer before the next request', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const rig = await setUp(context, extensionId);
  const second = await startDappServer();
  try {
    const other = await context.newPage();
    await other.goto(second.url);
    const win = await request(context, () =>
      rig.dapp.getByRole('button', { name: 'Connect wallet' }).click(),
    );
    await other.getByRole('button', { name: 'Connect wallet' }).click();
    await expect(win.getByText('1 of 2')).toBeVisible();
    await win.clock.install();
    await win.clock.pauseAt(Date.now() + 1_000);
    await win.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(win.getByText('Next request · 1 waiting')).toBeVisible();
    await shot(win, 'dapp-connected');
  } finally {
    second.server.close();
    rig.stop();
  }
});

test('sign: swap, fee sheet, raw, order', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const rig = await setUp(context, extensionId);
  try {
    await connect(context, rig.dapp);

    const win = await request(context, () => sign(rig.dapp, [swap()]));
    await expect(win.getByText('for at least', { exact: false })).toBeVisible();
    await shot(win, 'dapp-sign-swap');
    await win.getByRole('button', { name: /^Network fee/ }).click();
    await expect(win.getByRole('dialog')).toBeVisible();
    await shot(win, 'dapp-sign-fee');
    await win.keyboard.press('Escape');
    await win.getByRole('button', { name: /Message details/ }).click();
    await expect(win.getByText('Back to request')).toBeVisible();
    await shot(win, 'dapp-sign-raw');
    await win.getByRole('button', { name: 'Back to request' }).click();
    await reject(win);

    const order = await request(context, () => sign(rig.dapp, [sellOrder('0.320000000000000000')]));
    await expect(order.getByText('Sell order', { exact: false }).first()).toBeVisible();
    await shot(order, 'dapp-sign-order');
    await reject(order);
  } finally {
    rig.stop();
  }
});

test('sign: grant, ticked, unknown, multi', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const rig = await setUp(context, extensionId);
  try {
    await connect(context, rig.dapp);

    await rig.dapp.getByLabel('Recipient').fill(GRANTEE);
    const grant = await request(context, () =>
      rig.dapp.getByRole('button', { name: 'Grant authz to address 2' }).click(),
    );
    await expect(grant.getByRole('alert')).toBeVisible();
    await shot(grant, 'dapp-sign-grant');
    await grant.getByRole('checkbox').click();
    await expect(grant.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await shot(grant, 'dapp-sign-grant-ack');
    await reject(grant);

    const odd = await request(context, () => sign(rig.dapp, [unknown()]));
    await expect(odd.getByRole('note')).toBeVisible();
    await shot(odd, 'dapp-sign-unknown');
    await reject(odd);

    const multi = await request(context, () =>
      sign(rig.dapp, [cancelOrder(), sellOrder('0.335000000000000000')]),
    );
    await expect(multi.getByText('2 of 2')).toBeVisible();
    await shot(multi, 'dapp-sign-multi');
    await reject(multi);
  } finally {
    rig.stop();
  }
});

test('sign: queue, done, weak lock', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const rig = await setUp(context, extensionId);
  try {
    await connect(context, rig.dapp);

    const win = await request(context, () => sign(rig.dapp, [swap()]));
    await sign(rig.dapp, [sellOrder('0.320000000000000000')]);
    await expect(win.getByText('1 of 2')).toBeVisible();
    await shot(win, 'dapp-sign-next');
    // Holds the "Next request" screen, which otherwise lasts 0.6 s.
    await win.clock.install();
    await win.clock.pauseAt(Date.now() + 1_000);
    await win.getByRole('button', { name: 'Approve' }).click();
    await expect(win.getByText('Next request · 1 waiting')).toBeVisible();
    await shot(win, 'dapp-sign-done');
    await win.clock.resume();
    await expect(win.getByRole('heading', { name: 'Approve transaction' })).toBeVisible();
    await reject(win);

    // The weak-lock alarm firing is what locks the wallet lightly.
    await rig.popup.evaluate(() => chrome.alarms.create('weak-lock', { when: Date.now() + 200 }));
    await expect
      .poll(async () => {
        const res = (await call(rig.popup, 'wallet.state')) as { value: { state: string } };
        return res.value.state;
      })
      .toBe('weakLocked');
    const locked = await request(context, () => sign(rig.dapp, [swap()]));
    await locked.getByLabel('Password').fill(PASSWORD.replace(/./g, 'x').slice(0, 13));
    await shot(locked, 'dapp-sign-locked');
    await reject(locked);
  } finally {
    rig.stop();
  }
});

test('add a token', async ({ context, extensionId }) => {
  test.setTimeout(240_000);
  const popup = await openPopup(context, extensionId);
  await call(popup, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(popup, 'tokens.add', { denom: 'ubze' });
  await context.route('https://getbze.com/wallet/add/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Add</title><p>Add a token</p>',
    }),
  );
  const tab = await context.newPage();
  const [win] = await Promise.all([
    context.waitForEvent('page'),
    tab.goto(`https://getbze.com/wallet/add/?code=${encodeURIComponent(PAGE)}`, {
      referer: 'https://page-community.xyz/',
    }),
  ]);
  await win.setViewportSize({ width: 360, height: 600 });
  await expect(win.getByRole('button', { name: 'Add PAGE' })).toBeVisible();
  await shot(win, 'dapp-add-token');
});
