import { AndroidConfig, withAndroidManifest, withDangerousMod, withGradleProperties, withAppBuildGradle } from '@expo/config-plugins';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Keep these settings across Expo prebuild. Debug variants explicitly opt
// back into cleartext/overlay access in their own manifests for Metro.
export const ANDROID_MIN_SDK = 24;
export const OPTIONAL_HARDWARE = [
  'android.hardware.camera',
  'android.hardware.camera.autofocus',
  'android.hardware.camera.front',
  'android.hardware.location',
  'android.hardware.location.gps',
  'android.hardware.location.network',
  'android.hardware.screen.portrait',
  'android.hardware.telephony',
  'android.hardware.microphone',
];
// expo-location's library manifest always declares its background task
// service with foregroundServiceType="location". Chakusa never tracks in the
// background (app.json disables it and nothing uses expo-task-manager), so
// the service is removed: otherwise Play Console asks for a location
// foreground-service declaration for a capability the app does not have.
export const REMOVED_SERVICES = ['expo.modules.location.services.LocationTaskService'];

export default function withAndroidSecurity(config) {
  config = withAppBuildGradle(config, (config) => {
    // Expo's legacy default rules disable optimization even when minification
    // is enabled. Use Android's optimizing rules while retaining SDK keep rules.
    config.modResults.contents = config.modResults.contents.replace(
      /getDefaultProguardFile\(["']proguard-android\.txt["']\)/g,
      "getDefaultProguardFile('proguard-android-optimize.txt')",
    );
    return config;
  });
  config = withGradleProperties(config, (config) => {
    // Android 7 (API 24) is React Native's floor. Raising it to 29 cut ~30% of
    // phones from Play; the server (auth, Play Integrity) stays the security
    // boundary, so older devices are supported again.
    const properties = { 'android.enableMinifyInReleaseBuilds': 'true', 'android.enableShrinkResourcesInReleaseBuilds': 'true', 'android.minSdkVersion': String(ANDROID_MIN_SDK), 'org.gradle.jvmargs': '-Xmx3072m -XX:MaxMetaspaceSize=512m' };
    for (const [key, value] of Object.entries(properties)) {
      config.modResults = config.modResults.filter((entry) => entry.type !== 'property' || entry.key !== key);
      config.modResults.push({ type: 'property', key, value });
    }
    return config;
  });
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.$['android:allowBackup'] = 'false';
    application.$['android:usesCleartextTraffic'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/chakusa_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/chakusa_data_extraction_rules';
    manifest.manifest['uses-permission'] = (manifest.manifest['uses-permission'] ?? [])
      .filter((permission) => permission.$?.['android:name'] !== 'android.permission.SYSTEM_ALERT_WINDOW');
    // Permissions imply required hardware, and Play hides the app from every
    // device without it (tablets, Chromebooks, cars). Each of these is an
    // optional enhancement in Chakusa, so declare it not required.
    const features = (manifest.manifest['uses-feature'] ?? [])
      .filter((feature) => !OPTIONAL_HARDWARE.includes(feature.$?.['android:name']));
    for (const name of OPTIONAL_HARDWARE) features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    manifest.manifest['uses-feature'] = features;
    manifest.manifest.$['xmlns:tools'] = manifest.manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const services = (application.service ?? []).filter((service) => !REMOVED_SERVICES.includes(service.$?.['android:name']));
    for (const name of REMOVED_SERVICES) services.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
    application.service = services;
    return config;
  });
  // Some Android 12+ manufacturers allow D2D transfer despite allowBackup=false.
  // Explicit rules exclude private app data for both backup and transfer.
  return withDangerousMod(config, ['android', async (config) => {
    const output = join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await mkdir(output, { recursive: true });
    for (const file of ['chakusa_backup_rules.xml', 'chakusa_data_extraction_rules.xml']) {
      await copyFile(join(config.modRequest.projectRoot, 'security', file), join(output, file));
    }
    return config;
  }]);
}
