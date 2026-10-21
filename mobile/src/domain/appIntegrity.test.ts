import { describe, expect, it } from 'vitest';
import { CHAKUSA_SIGNING_CERTIFICATES, signingVerdict } from './appIntegrity';

const cloneKey = { sha256: ['AA:BB:CC:DD'], sha1: ['11:22:33:44'] };

describe('signingVerdict', () => {
  it('accepts the upload key by SHA-256', () => {
    expect(signingVerdict({ sha256: [CHAKUSA_SIGNING_CERTIFICATES.sha256[0]], sha1: [] })).toBe('genuine');
  });

  // Fingerprints as a Play-installed copy reports them (read with apksigner).
  const play = {
    sha256: ['42:31:19:EE:30:10:8C:7D:B7:CD:01:7E:37:C1:4B:2B:85:F4:78:08:8B:8B:39:65:C4:CC:04:28:92:10:4C:C1'],
    sha1: ['AF:99:0A:BC:23:F8:27:EB:96:20:CB:F3:EF:41:C3:DC:BF:05:6F:F4'],
  };

  it('accepts a real Google Play install', () => {
    expect(signingVerdict(play)).toBe('genuine');
  });

  it('accepts a Google Play install by either fingerprint alone', () => {
    expect(signingVerdict({ sha256: play.sha256, sha1: ['FF:FF'] })).toBe('genuine');
    expect(signingVerdict({ sha256: ['FF:FF'], sha1: play.sha1 })).toBe('genuine');
  });

  // A fingerprint of the wrong length (e.g. a SHA-256 cut down and filed as a
  // SHA-1) can never match a device and blocks every real install.
  it('lists only full-length fingerprints', () => {
    const hexLength = (value: string) => value.replace(/[^0-9a-f]/gi, '').length;
    for (const value of CHAKUSA_SIGNING_CERTIFICATES.sha256) expect(hexLength(value), value).toBe(64);
    for (const value of CHAKUSA_SIGNING_CERTIFICATES.sha1) expect(hexLength(value), value).toBe(40);
  });

  it('lists the Play app-signing key under both algorithms', () => {
    expect(CHAKUSA_SIGNING_CERTIFICATES.sha256).toContain(play.sha256[0]);
    expect(CHAKUSA_SIGNING_CERTIFICATES.sha1).toContain(play.sha1[0]);
  });

  it('ignores separators and letter case', () => {
    expect(signingVerdict({ sha256: [], sha1: ['325c1d123ab7b400e332ab29de8a1aa93d2b5f6f'] })).toBe('genuine');
  });

  it('rejects an APK re-signed with any other key', () => {
    expect(signingVerdict(cloneKey)).toBe('not-genuine');
  });

  it('rejects a clone that keeps one fake entry beside a mismatched one', () => {
    expect(signingVerdict({ sha256: ['00:11', 'DE:AD'], sha1: ['BE:EF'] })).toBe('not-genuine');
  });

  it('never blocks when the platform cannot report fingerprints', () => {
    expect(signingVerdict(null)).toBe('unknown');
    expect(signingVerdict(undefined)).toBe('unknown');
    expect(signingVerdict({ sha256: [], sha1: [] })).toBe('unknown');
  });
});
