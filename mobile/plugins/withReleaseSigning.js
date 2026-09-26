import { withAppBuildGradle } from '@expo/config-plugins';

// Release builds must be signed with the real upload keystore, never the
// debug key — a debug-signed AAB cannot be published, and worse, is
// unrevocable trust if ever mistaken for a real release. The generated
// android/app/build.gradle defaults every buildType (including release) to
// signingConfigs.debug; this plugin replaces that for the release variant
// only, reading credentials from the process environment (never a repo
// file, never gradle.properties) — CHAKUSA_UPLOAD_STORE_FILE,
// CHAKUSA_UPLOAD_STORE_PASSWORD, CHAKUSA_UPLOAD_KEY_ALIAS,
// CHAKUSA_UPLOAD_KEY_PASSWORD.
//
// Debug builds, `gradlew help`, and every other task are unaffected when
// those variables are unset — only bundleRelease/assembleRelease fail
// closed, with a clear message, instead of silently signing with debug.
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    const debugSigningConfigBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

    if (!contents.includes(debugSigningConfigBlock)) {
      throw new Error(
        "withReleaseSigning: expected debug signingConfigs block not found in android/app/build.gradle — the Expo/RN template shape has likely changed, update this plugin's match string.",
      );
    }

    const releaseSigningConfigBlock = `${debugSigningConfigBlock}
        release {
            def chakusaStoreFilePath = System.getenv("CHAKUSA_UPLOAD_STORE_FILE")
            if (chakusaStoreFilePath) {
                storeFile file(chakusaStoreFilePath)
                storePassword System.getenv("CHAKUSA_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("CHAKUSA_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("CHAKUSA_UPLOAD_KEY_PASSWORD")
            }
        }`;

    contents = contents.replace(debugSigningConfigBlock, releaseSigningConfigBlock);

    // The generated template has been observed both with and without an
    // "=" here across otherwise-identical prebuild runs — match either.
    const releaseBuildTypeSigningPattern = /signingConfig\s*=?\s*signingConfigs\.debug(\r?\n\s*def enableShrinkResources)/;
    if (!releaseBuildTypeSigningPattern.test(contents)) {
      throw new Error(
        "withReleaseSigning: expected release buildType block not found in android/app/build.gradle — update this plugin's match string.",
      );
    }
    contents = contents.replace(releaseBuildTypeSigningPattern, 'signingConfig signingConfigs.release$1');

    // Checked against the whole task graph (gradle.taskGraph.whenReady),
    // not a doFirst on just bundleRelease/assembleRelease themselves —
    // those tasks DEPEND ON packageReleaseBundle/signReleaseBundle, which
    // run first and would otherwise fail with a raw, confusing
    // NullPointerException (empty signingConfigs.release) before this
    // check's doFirst ever got a turn. Checking the whole graph fails
    // fast, before any task in a signing-relevant release build starts.
    const failClosedCheck = `
gradle.taskGraph.whenReady { graph ->
    def releaseSigningTaskRequested = graph.allTasks.any { it.path ==~ /:app:(bundle|assemble|sign|package).*Release.*/ }
    if (releaseSigningTaskRequested && !System.getenv("CHAKUSA_UPLOAD_STORE_FILE")) {
        throw new GradleException(
            "Release build blocked: set CHAKUSA_UPLOAD_STORE_FILE, CHAKUSA_UPLOAD_STORE_PASSWORD, " +
            "CHAKUSA_UPLOAD_KEY_ALIAS and CHAKUSA_UPLOAD_KEY_PASSWORD in the environment first. " +
            "This project never falls back to the debug keystore for a release build."
        )
    }
    // EXPO_PUBLIC_* values are inlined into the JS bundle at build time. A
    // release bundled without them ships with no API URL and a Google
    // Sign-In that cannot configure itself, so refuse to build one.
    def missingPublicConfig = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"].findAll { !System.getenv(it) }
    if (releaseSigningTaskRequested && !missingPublicConfig.isEmpty()) {
        throw new GradleException(
            "Release build blocked: missing " + missingPublicConfig.join(", ") + ". " +
            "Build through 'npm run android:bundle-release' (applies the eas.json production env)."
        )
    }
}
`;
    contents = contents + failClosedCheck;

    config.modResults.contents = contents;
    return config;
  });
}

export default withReleaseSigning;
