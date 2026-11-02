import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, test as base, type BrowserContext } from '@playwright/test';

const extensionPath = resolve(import.meta.dirname, '../dist');

/**
 * A browser that starts without the extension, so a page can be open before BeePocket is
 * installed. `ignoreDefaultArgs` keeps extensions enabled; `Extensions.loadUnpacked` (Chrome 126+)
 * then installs the build like the store would, firing `onInstalled` with `reason: 'install'`.
 */
export const test = base.extend<{
  context: BrowserContext;
  install: () => Promise<string>;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'beepocket-e2e-late-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging'],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  install: async ({ context }, use) => {
    await use(async () => {
      const browser = context.browser();
      if (!browser) throw new Error('no browser to install into');
      const cdp = await browser.newBrowserCDPSession();
      const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
      return id;
    });
  },
});

export const expect = test.expect;
