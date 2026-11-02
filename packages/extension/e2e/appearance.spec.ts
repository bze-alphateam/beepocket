import { expect, test } from './fixtures';

test('the appearance defaults to dark, the header button flips it and the choice persists', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  // The OS asks for light; the canvas default is dark anyway.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const root = page.locator('html');
  await expect(page.getByRole('button', { name: 'Create a new wallet' })).toBeVisible();
  await expect(root).toHaveAttribute('data-scheme', 'dark');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(root).toHaveAttribute('data-scheme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();

  // Stored outside the wallet: it holds on the next open, before any wallet exists.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create a new wallet' })).toBeVisible();
  await expect(root).toHaveAttribute('data-scheme', 'light');

  // `system` follows the OS live.
  await page.evaluate((m): Promise<unknown> => chrome.runtime.sendMessage(m), {
    method: 'appearance.set',
    payload: { appearance: 'system' },
  });
  await page.reload();
  await expect(root).toHaveAttribute('data-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-scheme', 'light');
});
