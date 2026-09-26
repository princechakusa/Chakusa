#!/usr/bin/env node
// Runs a command with the `env` block of an eas.json build profile applied.
//
// EAS cloud builds (iOS) receive eas.json's profile env automatically, but
// local builds (Android on Windows, `expo start --web`, Playwright) do not:
// without this, every EXPO_PUBLIC_* value is missing from the JS bundle,
// which leaves the app with no API URL and Google Sign-In without a client
// ID. Profile values win over the shell so a stale variable can never leak
// into a release bundle. eas.json only holds public, non-secret build
// config; signing credentials stay in the shell environment.
//
// Usage: node scripts/eas-env.mjs <profile> [--cwd <dir>] -- <command> [args...]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator < 1 || separator === args.length - 1) {
  console.error('Usage: node scripts/eas-env.mjs <profile> [--cwd <dir>] -- <command> [args...]');
  process.exit(2);
}
const [profile, ...options] = args.slice(0, separator);
const [command, ...commandArgs] = args.slice(separator + 1);
const cwdIndex = options.indexOf('--cwd');
const cwd = cwdIndex >= 0 && options[cwdIndex + 1] ? resolve(root, options[cwdIndex + 1]) : root;

const eas = JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8'));
const build = eas.build?.[profile];
if (!build) {
  console.error(`eas.json has no build profile "${profile}". Available: ${Object.keys(eas.build ?? {}).join(', ')}`);
  process.exit(2);
}
// Resolve one level of `extends` so derived profiles inherit their base env.
const baseEnv = build.extends ? eas.build?.[build.extends]?.env ?? {} : {};
const profileEnv = { ...baseEnv, ...(build.env ?? {}) };
console.log(`[eas-env] ${profile}: applying ${Object.keys(profileEnv).length} variables (${Object.keys(profileEnv).filter((key) => key.startsWith('EXPO_PUBLIC_')).length} EXPO_PUBLIC_*)`);

// Windows needs a shell to resolve .cmd shims (gradlew.bat, npx.cmd), and a
// shell concatenates arguments, so quote each one explicitly.
const quote = (value) => (/^[\w./:=@-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`);
const child = process.platform === 'win32'
  ? spawn([command, ...commandArgs].map(quote).join(' '), { cwd, env: { ...process.env, ...profileEnv }, stdio: 'inherit', shell: true })
  : spawn(command, commandArgs, { cwd, env: { ...process.env, ...profileEnv }, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
