import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests. `globalSetup` starts an in-memory Mongo replica set, seeds it and launches the
 * production server (serving client/dist) on a free port, exposed to tests as E2E_BASE_URL.
 * Run through `npm run e2e`, which builds the client first.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    timezoneId: 'Asia/Damascus', // same as the server's APP_TZ, so "today" agrees on both sides
    locale: 'en-US',
    // The production server only sets the secure session cookie behind a TLS-terminating proxy.
    extraHTTPHeaders: { 'x-forwarded-proto': 'https' },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: {} }],
});
