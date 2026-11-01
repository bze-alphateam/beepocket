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

test('tokens.lookup returns metadata and branding of a factory token', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const reply = await page.evaluate(
    (code): Promise<unknown> => chrome.runtime.sendMessage({ method: 'tokens.lookup', payload: { code } }),
    mockFactoryDenom,
  );
  expect(reply).toMatchObject({
    ok: true,
    value: {
      denom: mockFactoryDenom,
      symbol: 'GOLD',
      name: 'Gold Coin',
      decimals: 6,
      kind: 'factory',
      branding: { font: 'Inter', dark: { primary: '#FFB000' } },
    },
  });
});

test('tokens.lookup answers null branding on a 404 and no-such-token for zero supply', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const theme = await page.evaluate(
    (): Promise<unknown> => chrome.runtime.sendMessage({ method: 'tokens.theme', payload: { denom: 'ubze' } }),
  );
  expect(theme).toEqual({ ok: true, value: null });
  const unknown = await page.evaluate(
    (): Promise<unknown> =>
      chrome.runtime.sendMessage({ method: 'tokens.lookup', payload: { code: 'factory/bze1recorded/ghost' } }),
  );
  expect(unknown).toEqual({
    ok: false,
    error: { code: 'no-such-token', message: 'No token with this code on BeeZee' },
  });
});
