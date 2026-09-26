import { defineConfig } from '@playwright/test';

// End-to-end tests for the Chakusa app on Expo web, driven in Google Chrome
// at phone size. They exercise the real app against a real local API and a
// throwaway `chakusa_test` database - see e2e/README.md for starting that
// stack. Nothing here ever targets production.
//
//   npm run e2e            headless
//   npm run e2e:watch      visible Chrome, slowed down so a person can follow
//   E2E_HEADED=1           visible Chrome at full speed

const watch = process.env.E2E_WATCH === '1';
// E2E_HEADED=1: visible Chrome at full speed (for iterating on the tests).
const headed = watch || process.env.E2E_HEADED === '1';

export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../e2e-report', open: 'never' }]],
  outputDir: '../e2e-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
    channel: 'chrome',
    headless: !headed,
    viewport: { width: 390, height: 844 },
    // Pin motion on so the animation checks are deterministic on any machine.
    reducedMotion: 'no-preference',
    launchOptions: { slowMo: watch ? 180 : 0, args: ['--window-size=470,980'] },
    actionTimeout: 30_000,
    navigationTimeout: 240_000,
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'on',
  },
});
