// `npm run e2e:watch`: the whole suite in a visible Chrome window, slowed
// down and pausing on each screen so a person can follow along.
import { spawnSync } from 'node:child_process';
const result = spawnSync('npx', ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, E2E_WATCH: '1' },
});
process.exit(result.status ?? 1);
