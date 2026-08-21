import { AndroidConfig, withAndroidManifest } from '@expo/config-plugins';

const SERVICE_NAME = 'expo.modules.chakusacalldetection.ChakusaCallScreeningService';
const PHONE_STATE_PERMISSION = 'android.permission.READ_PHONE_STATE';
// Not used to read the address book — Telecom's CallScreeningServiceFilter
// checks for this permission before deciding whether to exempt a
// contacts-matched call from screening at all (AOSP
// packages/services/Telecomm CallFilteringCompletionInfo). Without it,
// ChakusaCallScreeningService is silently never invoked for calls from
// numbers already saved in the device's contacts.
const CONTACTS_PERMISSION = 'android.permission.READ_CONTACTS';

// Belt-and-suspenders alongside the module's own
// android/src/main/AndroidManifest.xml (a standard Android library manifest,
// merged automatically by Gradle) — this config plugin makes the same two
// additions explicitly, in the documented Expo way, so they're visible and
// debuggable directly from `expo prebuild` output rather than relying
// solely on manifest-merger behavior.
function withCallDetection(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [PHONE_STATE_PERMISSION, CONTACTS_PERMISSION]);

  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    application.service = application.service ?? [];
    const alreadyDeclared = application.service.some(
      (service) => service.$?.['android:name'] === SERVICE_NAME,
    );

    if (!alreadyDeclared) {
      application.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:permission': 'android.permission.BIND_SCREENING_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.telecom.CallScreeningService' } }],
          },
        ],
      });
    }

    return config;
  });
}

export default withCallDetection;
