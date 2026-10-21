import { withAppBuildGradle, withProjectBuildGradle } from '@expo/config-plugins';

// Windows-specific NDK linking regression: shared libraries that only
// depend on *static* prefab libraries (fbjni, folly_runtime, glog, jsi,
// ...) — react_codegen_safeareacontext, react_codegen_rnscreens,
// appmodules itself — come out missing libc++ runtime symbols
// (__cxa_begin_catch, __cxa_throw, std::ios_base::getloc, ...) even
// though ANDROID_STL=c++_shared is set project-wide (confirmed correct
// in CMakeCache.txt — the STL choice isn't the issue, the final .so link
// for these specific targets just isn't pulling it in). Still open
// upstream as of 2026-09:
// https://github.com/software-mansion/react-native-reanimated/issues/8269
//
// Forcing -lc++_shared onto every shared-library link via
// CMAKE_SHARED_LINKER_FLAGS fixes it. This must be injected directly into
// android/app/build.gradle's own defaultConfig block, textually — a
// root-level `subprojects { }` mutation was tried first and reliably lost
// the race against com.facebook.react's own plugin, which configures
// externalNativeBuild.cmake itself and clobbers anything set before it
// via afterEvaluate/plugins.withId regardless of hook ordering.
//
// NDK downgrade to 26.x was also tried and made things worse (folly's
// C++20 dynamic/Formatter templates fail to compile under NDK 26's older
// Clang) — 27.x is react-native 0.86's real requirement, not the problem.
const LINKER_FLAG = '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,--no-as-needed -lc++_shared';

// Native libraries that build their own .so in their own Gradle module hit
// the same regression (react-native-worklets: undefined std::__ndk1 /
// operator new / __cxa_* at link). The app-level hook above never reaches a
// library module, so apply the same flag to each one through its own
// finalizeDsl, which runs after the library has declared its CMake args.
const NATIVE_LIBRARY_MODULES = ['react-native-worklets', 'react-native-reanimated'];
const LIBRARY_MARKER = '// chakusa: c++_shared for native library modules';

function withLibraryCppStlLinkerFix(config) {
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (contents.includes(LIBRARY_MARKER)) return config;
    contents += `

${LIBRARY_MARKER}
subprojects { sub ->
    if (${JSON.stringify(NATIVE_LIBRARY_MODULES)}.contains(sub.name)) {
        sub.plugins.withId("com.android.library") {
            sub.androidComponents {
                finalizeDsl { extension ->
                    extension.defaultConfig.externalNativeBuild.cmake.arguments.add("${LINKER_FLAG}")
                }
            }
        }
    }
}
`;
    config.modResults.contents = contents;
    return config;
  });
}

function withCppStlLinkerFix(config) {
  config = withLibraryCppStlLinkerFix(config);
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Both a direct (immediate) DSL call and a plain `afterEvaluate` block
    // were tried and, despite genuinely mutating
    // android.defaultConfig.externalNativeBuild.cmake.arguments (confirmed
    // by printing its contents), the added flag never reached the actual
    // `cmake` invocation (metadata_generation_command.txt) — because
    // react-native's own gradle-plugin (NdkConfiguratorUtils.kt) adds ITS
    // defaults via AGP's `ApplicationAndroidComponentsExtension.finalizeDsl`,
    // a distinct, Variant-API-level hook that AGP reads the DSL through
    // for command construction — NOT the classic per-project
    // `afterEvaluate` FIFO queue. A plain `afterEvaluate` mutation can
    // still land in the *list object* (both share the same list) but
    // arrive too late relative to whatever internal step actually freezes
    // the CMake command line. The only way this measurably worked was
    // hooking through the exact same `finalizeDsl` mechanism RN's plugin
    // uses, registered after it so it runs after RN's own additions.
    const anchor = 'apply plugin: "com.facebook.react"';
    if (!contents.includes(anchor)) {
      throw new Error(
        `withCppStlLinkerFix: expected "${anchor}" not found in android/app/build.gradle — update this plugin's match string.`,
      );
    }

    contents = contents.replace(
      anchor,
      `${anchor}

androidComponents {
    finalizeDsl { extension ->
        extension.defaultConfig.externalNativeBuild.cmake.arguments.add("${LINKER_FLAG}")
    }
}`,
    );

    config.modResults.contents = contents;
    return config;
  });
}

export default withCppStlLinkerFix;
