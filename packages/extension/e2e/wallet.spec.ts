import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;

/** Plays the BZE node for the service worker: `funded` addresses hold coins, all others are unknown. */
async function mockNode(context: BrowserContext, funded: string[]): Promise<void> {
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    const balances = /\/cosmos\/bank\/v1beta1\/balances\/(.+)$/.exec(url.pathname);
    if (balances?.[1] !== undefined) {
      const has = funded.includes(decodeURIComponent(balances[1]));
      return route.fulfill({
        json: {
          balances: has ? [{ denom: 'ubze', amount: '1000' }] : [],
          pagination: { next_key: null, total: has ? '1' : '0' },
        },
      });
    }
    return route.fulfill({ status: 404, json: { code: 5, message: 'not found', details: [] } });
  });
}

async function open(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

/** The fields the tests read; every reply is a protocol `Result`. */
interface Reply {
  value: {
    state: string;
    status: string;
    retryAt: number | null;
    addresses: { index: number; label: string; address: string }[];
  };
  error: { code: string };
}

async function call(page: Page, method: string, payload: unknown): Promise<Reply> {
  return (await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), {
    method,
    payload,
  })) as Reply;
}

test('create, lock, unlock', async ({ context, extensionId }) => {
  const page = await open(context, extensionId);
  expect(await call(page, 'wallet.state', {})).toMatchObject({
    ok: true,
    value: { state: 'uninitialised' },
  });

  const created = await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  expect(created.value.addresses).toEqual([
    { index: 0, label: 'Main', address: deriveAccount(PHRASE, 0).address },
  ]);
  expect((await call(page, 'wallet.state', {})).value.state).toBe('unlocked');

  await call(page, 'wallet.lock', {});
  expect((await call(page, 'wallet.state', {})).value.state).toBe('locked');
  expect((await call(page, 'wallet.addresses', {})).error.code).toBe('wallet_locked');

  expect((await call(page, 'wallet.unlock', { password: PASSWORD })).value.status).toBe('ok');
  expect((await call(page, 'wallet.addresses', {})).value.addresses).toHaveLength(1);
});

test('wrong passwords are throttled after five tries', async ({ context, extensionId }) => {
  const page = await open(context, extensionId);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });
  await call(page, 'wallet.lock', {});

  for (let i = 0; i < 4; i++) {
    const r = await call(page, 'wallet.unlock', { password: 'not the password' });
    expect(r.value).toEqual({ status: 'wrong-password', retryAt: null });
  }
  const before = Date.now();
  const fifth = await call(page, 'wallet.unlock', { password: 'not the password' });
  expect(fifth.value.status).toBe('wrong-password');
  expect(fifth.value.retryAt).toBeGreaterThanOrEqual(before + 29_000);

  const blocked = await call(page, 'wallet.unlock', { password: PASSWORD });
  expect(blocked.value.status).toBe('throttled');
  expect((await call(page, 'wallet.state', {})).value.retryAt).toBe(blocked.value.retryAt);
});

test('import keeps a funded address 2 and drops the empty ones', async ({
  context,
  extensionId,
}) => {
  await mockNode(context, [deriveAccount(PHRASE, 2).address]);
  const page = await open(context, extensionId);
  const imported = await call(page, 'wallet.importWallet', {
    password: PASSWORD,
    mnemonic: PHRASE,
  });
  expect(imported.value.addresses.map((a: { index: number }) => a.index)).toEqual([0, 2]);
  expect(imported.value.addresses[1]?.label).toBe('Address 3');
});
