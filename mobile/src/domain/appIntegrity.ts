// Genuine-build check for Android. A repackaged (cloned) Chakusa APK must be
// re-signed with someone else's key, so its certificate fingerprints won't
// match ours. This deters casual repackaging only: a determined attacker can
// patch it out, which is why the server verifies Play Integrity as well.

export interface SigningFingerprints {
  sha256: string[];
  sha1: string[];
}

// SHA-256 where it is recorded; SHA-1 where only that is known (Play Console
// and the Google OAuth clients list SHA-1). See docs/OWNER_ACTIONS.md OA-11.
export const CHAKUSA_SIGNING_CERTIFICATES = {
  sha256: [
    // Upload key chakusa-upload-2026-10 (local and internal-testing builds).
    '03:A5:1A:46:8C:7C:99:0C:F8:58:2A:EE:FE:86:27:1B:6A:40:C4:A4:77:57:E8:15:C4:85:E8:AA:55:A4:F8:F3',
    // Google Play app-signing key: every install from Google Play. Read with
    // apksigner from a Play-installed copy on 2026-10-21.
    '42:31:19:EE:30:10:8C:7D:B7:CD:01:7E:37:C1:4B:2B:85:F4:78:08:8B:8B:39:65:C4:CC:04:28:92:10:4C:C1',
  ],
  sha1: [
    // Upload key chakusa-upload-2026-10.
    '32:5C:1D:12:3A:B7:B4:00:E3:32:AB:29:DE:8A:1A:A9:3D:2B:5F:6F',
    // Google Play app-signing key: every install from Google Play.
    '42:31:19:EE:30:10:8C:7D:B7:CD:01:7E:37:C1:4B:2B:85:F4:78:08',
    // Google Play app-signing key, real SHA-1 read with apksigner from a
    // Play-installed copy on 2026-10-21. The entry above is the first 20 bytes
    // of its SHA-256, recorded by mistake, so it never matched a device.
    'AF:99:0A:BC:23:F8:27:EB:96:20:CB:F3:EF:41:C3:DC:BF:05:6F:F4',
    // Previous upload key (2026-09), so existing internal-test installs keep working.
    '3B:07:CF:9F:66:A7:FA:45:AF:CE:AB:13:42:85:F3:1B:98:A2:C6:4B',
  ],
} as const satisfies SigningFingerprints;

const normalize = (value: string) => value.replace(/[^0-9a-f]/gi, '').toUpperCase();

export type IntegrityVerdict = 'genuine' | 'not-genuine' | 'unknown';

/**
 * 'unknown' when the platform cannot report (iOS, web, dev builds, a build
 * without the native module): those are never blocked. 'not-genuine' only
 * when fingerprints were reported and none of them is a Chakusa key.
 */
export function signingVerdict(info: SigningFingerprints | null | undefined, allowed: SigningFingerprints = CHAKUSA_SIGNING_CERTIFICATES): IntegrityVerdict {
  if (!info || (info.sha256.length === 0 && info.sha1.length === 0)) return 'unknown';
  const known256 = new Set(allowed.sha256.map(normalize));
  const known1 = new Set(allowed.sha1.map(normalize));
  const matches = info.sha256.some(f => known256.has(normalize(f))) || info.sha1.some(f => known1.has(normalize(f)));
  return matches ? 'genuine' : 'not-genuine';
}
