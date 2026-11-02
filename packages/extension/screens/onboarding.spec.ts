import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { startDappServer } from '../e2e/mock-server';
import { call, openPopup, PAGE, reload, seedWallet, shot, test } from './support';

// The first-run flow (Ob-* boards) and the unlock screen with a site waiting.

/** Creation and the first tokens.add run the real key derivation. */
test.setTimeout(180_000);

const ADD_PAGE = readFileSync(resolve(import.meta.dirname, '../e2e/addtoken/index.html'), 'utf8');
const LINK = `https://getbze.com/wallet/add/?code=${encodeURIComponent(PAGE)}`;

const title = (page: Page, text: string) => page.getByRole('heading', { name: text }).waitFor();

/** Create → phrase (revealed, ticked) → check → password, shooting each step; ends on Start. */
async function createToStart(page: Page, shots: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Create a new wallet' }).click();
  await page.getByRole('button', { name: 'Reveal phrase' }).waitFor();
  if (shots) await shot(page, 'ob-phrase-hidden');
  await page.getByRole('button', { name: 'Reveal phrase' }).click();
  const words = await page
    .locator('.bp-words .bp-word')
    .evaluateAll((items) => items.map((li) => li.lastElementChild?.textContent ?? ''));
  await page.getByRole('checkbox').check();
  if (shots) await shot(page, 'ob-phrase');
  await page.getByRole('button', { name: 'Continue' }).click();

  await title(page, 'Check your phrase');
  for (const quiz of await page.locator('fieldset').all()) {
    const legend = (await quiz.locator('legend').textContent()) ?? '';
    const position = Number(/#(\d+)/.exec(legend)?.[1]);
    await quiz.getByRole('button', { name: words[position - 1] ?? '', exact: true }).click();
  }
  if (shots) await shot(page, 'ob-confirm');
  await page.getByRole('button', { name: 'Continue' }).click();

  await title(page, 'Set a password');
  await page.getByLabel('Password', { exact: true }).fill('hive-glow-2026!');
  await page.getByLabel('Repeat password').fill('hive-glow-2026!');
  await page.getByText('Passwords match').waitFor();
  if (shots) await shot(page, 'ob-password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await title(page, 'How do you want to start?');
}

/** A well-formed code no token has: the node reports no supply for it. */
const NO_TOKEN = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pf7k/unone';

test('onboarding: create, check, password, start, tokens', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await context.route('https://rest.getbze.com/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/supply/by_denom') || url.searchParams.get('denom') !== NO_TOKEN)
      return route.fallback();
    return route.fulfill({ json: { amount: { denom: NO_TOKEN, amount: '0' } } });
  });
  await reload(page, 'Create a new wallet');
  await shot(page, 'ob-welcome');
  await createToStart(page, true);
  await shot(page, 'ob-start');

  const code = page.getByLabel('Token code', { exact: true });
  await page.getByRole('radio', { name: 'I have a token code' }).click();
  await code.fill(PAGE);
  await page.getByRole('button', { name: 'Open wallet with PAGE' }).waitFor();
  await shot(page, 'ob-start-code');
  await code.fill(NO_TOKEN);
  await page.getByRole('alert').waitFor();
  await shot(page, 'ob-start-bad');
  await page.getByRole('radio', { name: "I'll choose my tokens" }).click();
  await shot(page, 'ob-start-manual');

  await page.getByRole('button', { name: 'Continue' }).click();
  await title(page, 'Pick your tokens');
  const rows = page.getByRole('checkbox');
  await rows.first().waitFor();
  // The list's third row stands in for the board's single pick (PAGE there).
  const count = await rows.count();
  await rows.nth(Math.min(2, count - 1)).click();
  await page.getByText('1 selected · no token switcher').waitFor();
  await shot(page, 'ob-tokens-one');
  for (let i = 0; i < Math.min(4, count); i++) {
    if ((await rows.nth(i).getAttribute('aria-checked')) !== 'true') await rows.nth(i).click();
  }
  await shot(page, 'ob-tokens');
});

test('onboarding: import with a wrong word', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await reload(page, 'Create a new wallet');
  await page.getByRole('button', { name: 'Import a recovery phrase' }).click();
  await title(page, 'Import recovery phrase');
  const words = ['marble', 'echo', 'tribe', 'velvet', 'pioneer', 'gost', 'lizard', 'fiscal'];
  for (const [i, w] of words.entries())
    await page.getByLabel(`Word ${String(i + 1)}`, { exact: true }).fill(w);
  await page.getByText('Did you mean "ghost"?').waitFor();
  await shot(page, 'ob-import');
});

test('onboarding: unlock, and unlock with a site waiting', async ({ context, extensionId }) => {
  const page = await openPopup(context, extensionId);
  await seedWallet(page);
  await call(page, 'wallet.lock');
  await reload(page, 'Welcome back');
  await shot(page, 'ob-unlock');

  const { server, url } = await startDappServer();
  try {
    const dapp = await context.newPage();
    await dapp.goto(url);
    const [request] = await Promise.all([
      context.waitForEvent('page'),
      dapp.getByRole('button', { name: 'Connect wallet' }).click(),
    ]);
    await request.getByLabel('Password').waitFor();
    await reload(page, 'is waiting');
    await shot(page, 'ob-unlock-request');
  } finally {
    server.close();
  }
});

/** Opens an add-a-token link before any wallet exists: the window lands on onboarding. */
async function linkWindow(context: BrowserContext): Promise<Page> {
  await context.route('https://getbze.com/wallet/add/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: ADD_PAGE }),
  );
  const site = await context.newPage();
  const [win] = await Promise.all([
    context.waitForEvent('page'),
    site.goto(LINK, { referer: 'https://page-community.xyz/' }),
  ]);
  await win.setViewportSize({ width: 360, height: 600 });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.getByRole('button', { name: 'Create a new wallet' }).waitFor();
  await call(win, 'appearance.set', { appearance: 'system' });
  return win;
}

test('onboarding: from an add-a-token link', async ({ context, extensionId }) => {
  // The popup page sets up the canned network answers the window needs.
  const popup = await openPopup(context, extensionId);
  await popup.close();
  const win = await linkWindow(context);
  await win.getByText('Setting up for PAGE').waitFor();
  await shot(win, 'ob-welcome-link');
  await createToStart(win, false);
  await win.getByRole('button', { name: 'Open wallet with PAGE' }).waitFor();
  await shot(win, 'ob-start-link');
});
