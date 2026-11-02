import { deriveAccount } from '@beepocket/core';
import { expect, test } from './fixtures';
import { mockFactoryDenom, mockReply } from './mock-server';

/** Answers the node and Scan hosts of mainnet from the recorded fixtures. */
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/(rest|explorer)\.getbze\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const reply = mockReply(url.pathname + url.search);
    await route.fulfill({
      status: reply.status,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
});

test('create a wallet, confirm words, set a password and start with a token code', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.getByRole('button', { name: 'Create a new wallet' }).click();
  await page.getByRole('button', { name: 'Reveal phrase' }).click();
  const words = await page
    .locator('.bp-words .bp-word')
    .evaluateAll((items) => items.map((li) => li.lastElementChild?.textContent ?? ''));
  expect(words).toHaveLength(24);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  for (const quiz of await page.locator('fieldset').all()) {
    const legend = (await quiz.locator('legend').textContent()) ?? '';
    const position = Number(/#(\d+)/.exec(legend)?.[1]);
    await quiz.getByRole('button', { name: words[position - 1] ?? '', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByLabel('Repeat password').fill('correct horse');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('radio', { name: 'I have a token code' }).click();
  await page.getByLabel('Token code', { exact: true }).fill(mockFactoryDenom);
  await page.getByLabel('Token code', { exact: true }).press('Enter');
  await expect(page.getByText('Gold Coin')).toBeVisible();
  await page.getByRole('button', { name: 'Open wallet with GOLD' }).click();
  await expect(page.getByRole('button', { name: 'Open wallet with GOLD' })).toBeHidden();

  const state = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'wallet.state', payload: {} }),
  );
  expect(state).toMatchObject({ ok: true, value: { state: 'unlocked' } });
  const preferred = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'tokens.preferred', payload: {} }),
  );
  expect(preferred).toMatchObject({ ok: true, value: [{ denom: mockFactoryDenom }] });
});

test('import a 12-word phrase by pasting it into a cell, set a password and reach the wallet', async ({
  context,
  extensionId,
}) => {
  // Importing runs the real key derivation, which is slow on CI.
  test.setTimeout(120_000);
  const phrase = `${'abandon '.repeat(11)}about`;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.getByRole('button', { name: 'Import a recovery phrase' }).click();
  // A real paste event on cell 5: the whole phrase fills every cell.
  await page.getByLabel('Word 5', { exact: true }).evaluate((cell, text) => {
    const data = new DataTransfer();
    data.setData('text', text);
    cell.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, phrase);
  await expect(page.getByLabel('Word 12', { exact: true })).toHaveValue('about');
  await expect(page.getByLabel('Word 1', { exact: true })).toHaveValue('abandon');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByLabel('Repeat password').fill('correct horse');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('radio', { name: "I'll choose my tokens" }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox', { name: /^BZE/ }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  const state = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'wallet.state', payload: {} }),
  );
  expect(state).toMatchObject({ ok: true, value: { state: 'unlocked' } });
  const addresses = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'wallet.addresses', payload: {} }),
  );
  expect(addresses).toMatchObject({
    ok: true,
    value: { addresses: [{ address: deriveAccount(phrase, 0).address }] },
  });
});
