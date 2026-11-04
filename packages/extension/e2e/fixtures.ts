import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

const extensionPath = resolve(import.meta.dirname, '../dist');

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'beepocket-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    // Headless Chromium has no toolbar to anchor the popup to, so the suites drive the wallet
    // window, the fallback: every service worker (a restarted one too) gets an openPopup that
    // rejects. The popup screens are covered by opening popup.html in a tab.
    context.on('serviceworker', (worker) => void noToolbarPopup(worker));
    for (const worker of context.serviceWorkers()) await noToolbarPopup(worker);
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    await use(id);
  },
});

export const expect = test.expect;

async function noToolbarPopup(worker: Worker): Promise<void> {
  await worker
    .evaluate(() => {
      Object.assign(chrome.action, {
        openPopup: () => Promise.reject(new Error('No toolbar in e2e.')),
      });
    })
    .catch(() => undefined);
}
