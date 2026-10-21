// Production iOS build on EAS with auto-submit to TestFlight, behind preflight
// checks that catch the failures which otherwise surface only after a long
// cloud build: a reused buildNumber (TestFlight rejects it), type errors, or a
// logged-out EAS CLI. iOS is never built locally.
//
// Usage: npm run ios:release
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shell = process.platform === 'win32';

const run = (command, args, { capture = false } = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', shell, encoding: 'utf8' });
  return { ok: result.status === 0, out: result.stdout ?? '' };
};
const fail = (message) => {
  console.error(`[ios-release] BLOCKED: ${message}`);
  process.exit(1);
};

const buildNumber = Number(JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8')).expo?.ios?.buildNumber);
if (!Number.isInteger(buildNumber) || buildNumber < 1) fail('app.json expo.ios.buildNumber is missing or not a positive integer.');

console.log('[ios-release] checking EAS login');
if (!run('npx', ['--no-install', 'eas', 'whoami'], { capture: true }).ok) fail('EAS CLI is not logged in. Run `npx eas login`.');

console.log('[ios-release] checking the last EAS iOS build number');
const list = run('npx', ['--no-install', 'eas', 'build:list', '--platform', 'ios', '--limit', '10', '--json', '--non-interactive'], { capture: true });
if (!list.ok) fail('could not list previous EAS iOS builds.');
const previous = JSON.parse(list.out.slice(list.out.indexOf('[')))
  .filter((build) => build.status !== 'ERRORED' && build.status !== 'CANCELED')
  .map((build) => Number(build.appBuildVersion))
  .filter(Number.isInteger);
const highest = previous.length ? Math.max(...previous) : 0;
if (buildNumber <= highest) fail(`buildNumber ${buildNumber} is not above the last EAS iOS build (${highest}). Bump expo.ios.buildNumber in app.json.`);

console.log('[ios-release] typecheck');
if (!run('npm', ['run', 'typecheck']).ok) fail('typecheck failed.');

console.log(`[ios-release] building buildNumber ${buildNumber} on EAS with auto-submit to TestFlight`);
const build = run('npx', ['--no-install', 'eas', 'build', '--platform', 'ios', '--profile', 'production', '--auto-submit', '--non-interactive']);
if (!build.ok) fail('EAS build or submit failed; read the build log URL above.');
console.log('[ios-release] build finished and submitted to TestFlight');
