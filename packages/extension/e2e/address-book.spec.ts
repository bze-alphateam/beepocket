import { deriveAccount } from '@beepocket/core';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'correct horse';
const PHRASE = `${'abandon '.repeat(23)}art`;
const CONTACT = deriveAccount(PHRASE, 7).address;

async function open(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

async function call(page: Page, method: string, payload: unknown): Promise<unknown> {
  return page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), { method, payload });
}

test.beforeEach(async ({ context }) => {
  await context.route('https://rest.getbze.com/**', (route) =>
    route.fulfill({ status: 404, json: { code: 5, message: 'not found', details: [] } }),
  );
});

test('a contact is added, found, matched, kept after reopening the popup and deleted', async ({
  context,
  extensionId,
}) => {
  const page = await open(context, extensionId);
  await call(page, 'wallet.createWallet', { password: PASSWORD, mnemonic: PHRASE });

  expect(await call(page, 'book.add', { name: 'Alex', address: CONTACT })).toEqual({
    ok: true,
    value: { contacts: [{ name: 'Alex', address: CONTACT }] },
  });
  expect(await call(page, 'book.match', { input: CONTACT })).toEqual({
    ok: true,
    value: { kind: 'contact', name: 'Alex' },
  });
  expect(await call(page, 'book.add', { name: 'Again', address: CONTACT })).toMatchObject({
    ok: false,
    error: { code: 'duplicate-contact' },
  });

  await page.close();
  const reopened = await open(context, extensionId);
  expect(await call(reopened, 'book.list', {})).toMatchObject({
    ok: true,
    value: { contacts: [{ name: 'Alex', address: CONTACT }] },
  });

  expect(await call(reopened, 'book.remove', { address: CONTACT })).toEqual({
    ok: true,
    value: { contacts: [] },
  });
  expect(await call(reopened, 'book.match', { input: CONTACT })).toEqual({
    ok: true,
    value: { kind: 'unknown' },
  });
});
