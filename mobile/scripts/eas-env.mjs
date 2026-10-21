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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
// A wrapper script in --cwd (gradlew / gradlew.bat) is resolved to an absolute
// path: cmd.exe skips the current directory when
// NoDefaultCurrentDirectoryInExePath is set (Git Bash, Claude Code), and POSIX
// shells never search it, so a bare `gradlew` fails with "not recognized".
const resolveLocal = (name) => {
  const candidates = process.platform === 'win32' ? [`${name}.bat`, `${name}.cmd`, name] : [name];
  const found = candidates.map((candidate) => resolve(cwd, candidate)).find((path) => existsSync(path) && statSync(path).isFile());
  return found ?? name;
};
const executable = /[\\/]/.test(command) ? command : resolveLocal(command);

// Gradle compiles with the JVM it runs on; a JRE in JAVA_HOME (no javac) fails
// deep in the build with "does not provide the required capabilities:
// [JAVA_COMPILER]". Fall back to an installed JDK 17 and say so.
const childEnv = { ...process.env, ...profileEnv };
const javac = process.platform === 'win32' ? 'javac.exe' : 'javac';
const hasJavac = (home) => Boolean(home) && existsSync(join(home, 'bin', javac));
if (/gradlew/i.test(executable) && !hasJavac(childEnv.JAVA_HOME)) {
  const jdkRoots = process.platform === 'win32'
    ? ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Microsoft']
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines'];
  const jdks = jdkRoots
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)))
    .flatMap((home) => [home, join(home, 'Contents', 'Home')])
    .filter((home) => /jdk-?17|17.*jdk/i.test(home) && hasJavac(home));
  const studioJbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (process.platform === 'win32' && hasJavac(studioJbr)) jdks.push(studioJbr);
  if (!jdks.length) {
    console.error(`[eas-env] JAVA_HOME (${childEnv.JAVA_HOME ?? 'unset'}) has no javac and no JDK 17 was found. Install a JDK 17 and point JAVA_HOME at it.`);
    process.exit(2);
  }
  console.log(`[eas-env] JAVA_HOME (${childEnv.JAVA_HOME ?? 'unset'}) is not a JDK; using ${jdks[0]}`);
  childEnv.JAVA_HOME = jdks[0];
}
const child = process.platform === 'win32'
  ? spawn([executable, ...commandArgs].map(quote).join(' '), { cwd, env: childEnv, stdio: 'inherit', shell: true })
  : spawn(executable, commandArgs, { cwd, env: childEnv, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
