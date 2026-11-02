import { defineConfig } from '@playwright/test';

/** The screens walker: screenshots for design review, never run in CI. */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  outputDir: '../test-results/screens',
});
