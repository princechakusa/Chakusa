import { AndroidConfig, withAndroidManifest, withDangerousMod, withGradleProperties, withAppBuildGradle } from '@expo/config-plugins';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Keep these settings across Expo prebuild. Debug variants explicitly opt
// back into cleartext/overlay access in their own manifests for Metro.
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
    for (const key of ['android.enableMinifyInReleaseBuilds', 'android.enableShrinkResourcesInReleaseBuilds']) {
      config.modResults = config.modResults.filter((entry) => entry.type !== 'property' || entry.key !== key);
      config.modResults.push({ type: 'property', key, value: 'true' });
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
