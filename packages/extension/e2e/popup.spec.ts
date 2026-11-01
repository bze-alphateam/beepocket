import { expect, test } from './fixtures';

test('popup shows BeePocket', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('heading', { name: 'BeePocket' })).toBeVisible();
});
