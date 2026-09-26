// Builds the production web bundle the E2E suite runs against, pointed at a
// local test API. Static files need no dev server: faster, steadier under
// load, and closer to what users actually get.
//   node e2e/build-web.mjs            -> dist-e2e/
import { spawnSync } from 'node:child_process';
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: process.env.E2E_API_URL ?? 'http://localhost:4000',
  EXPO_PUBLIC_EMAIL_ENABLED: 'true',
  EXPO_PUBLIC_PASSWORD_RESET_EMAIL_ENABLED: 'false',
  // On so the tests prove web hides the native-only Google/Apple buttons.
  EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: 'true',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'e2e-placeholder.apps.googleusercontent.com',
  EXPO_PUBLIC_APPLE_AUTH_ENABLED: 'true',
  EXPO_PUBLIC_BILLING_ENABLED: 'false',
  EXPO_PUBLIC_SENTRY_ENABLED: 'false',
  EXPO_PUBLIC_AUTOMATION_ENABLED: 'true',
};
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-e2e'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
