import { expect, test } from './fixtures';

test('popup opens in the BeePocket theme', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('.bp-frame')).toBeVisible();
  const primary = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--bp-primary'),
  );
  expect(['#3DD07A', '#1A7A43']).toContain(primary);
});

test('app.ping makes the round trip popup → worker → popup', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const reply = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'app.ping', payload: { nonce: 'round-trip' } }),
  );
  expect(reply).toMatchObject({ ok: true, value: { nonce: 'round-trip' } });
});

test('an unknown request returns a { code, message } error', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const reply = await page.evaluate((): Promise<unknown> =>
    chrome.runtime.sendMessage({ method: 'no.such.method', payload: {} }),
  );
  expect(reply).toEqual({
    ok: false,
    error: { code: 'unknown_method', message: expect.stringContaining('no.such.method') },
  });
});
