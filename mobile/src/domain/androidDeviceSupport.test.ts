import { describe, expect, it } from 'vitest';
import { ANDROID_MIN_SDK, OPTIONAL_HARDWARE } from '../../plugins/withAndroidSecurity.js';

// Play excludes every device that lacks a required feature or runs an older
// Android than minSdk. Raising either silently drops thousands of devices
// (vc5: -5,209), so changes here must be deliberate.
describe('Android device reach', () => {
  it('installs on Android 7 (React Native floor) and newer', () => {
    expect(ANDROID_MIN_SDK).toBe(24);
  });

  it('never requires hardware that tablets, Chromebooks or cars lack', () => {
    for (const feature of ['android.hardware.camera', 'android.hardware.location', 'android.hardware.location.gps', 'android.hardware.screen.portrait', 'android.hardware.telephony']) {
      expect(OPTIONAL_HARDWARE).toContain(feature);
    }
  });
});
