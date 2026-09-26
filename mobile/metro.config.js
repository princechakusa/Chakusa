const path = require('path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname, {
  includeWebReplay: false,
  annotateReactComponents: false,
});

// Keep Metro out of generated output inside the project: Playwright's
// results/report (videos and traces written continuously during a run) and
// `expo export` folders (dist-*). Metro re-scans on every file event there,
// which stalled bundle requests for ~100 s during E2E runs. Patterns are
// anchored to this project so nothing under node_modules is affected.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const generated = ['e2e-results', 'e2e-report', 'dist-[^\\\\/]*'].map(
  (folder) => new RegExp(`^${escape(__dirname + path.sep)}${folder}[\\\\/].*`),
);
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...generated];

module.exports = config;
