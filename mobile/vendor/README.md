# Vendored security forks

`braces` and `node-forge` have published high-severity advisories with no upstream fix:

- `braces` <= 3.0.3: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack exhaustion from deeply nested patterns.
- `node-forge` <= 1.4.0: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), PKCS#1 v1.5 verification accepting extra nested DigestAlgorithm elements.

These tarballs are the upstream packages with our fixes applied. They were previously `patch-package` patches. `package.json` `overrides` points every dependent package (Expo CLI, patch-package/micromatch) at them, so the vulnerable registry code is no longer installed.

`npm audit` does not evaluate local `file:` packages. The evidence that these forks are fixed is `npm run security:mobile-dependencies` at the repository root. It replays the attack inputs and checks that ordinary patterns and valid signatures still work. It runs in CI.

Remove a fork, and its override, once upstream publishes a release that includes the fix and that test passes against it.
