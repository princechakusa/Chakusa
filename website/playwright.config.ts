import { defineConfig } from "@playwright/test";

// Two suites, both in the locally installed Google Chrome:
// - live:   smoke-tests the production site (every page loads, no uncaught
//           errors, no CSP violations, no broken same-origin assets). Signed
//           out, because sign-in is protected by Cloudflare Turnstile, which
//           is deliberately not bypassed.
// - mocked: runs the built site locally with the auth gateway answered by
//           fixtures, to exercise dashboard behaviour and client-side
//           security properties without real credentials.
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: true,
  workers: 4,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { channel: "chrome", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "live", testMatch: /live\.spec\.ts/, use: { baseURL: "https://chakusarecovery.com" } },
    { name: "mocked", testMatch: /mocked\.spec\.ts/, use: { baseURL: "http://localhost:4321" } },
  ],
  webServer: {
    command: "npx astro preview --port 4321",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
