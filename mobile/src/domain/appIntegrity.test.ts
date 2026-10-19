import { describe, expect, it } from 'vitest';
import { CHAKUSA_SIGNING_CERTIFICATES, signingVerdict } from './appIntegrity';

const cloneKey = { sha256: ['AA:BB:CC:DD'], sha1: ['11:22:33:44'] };

describe('signingVerdict', () => {
  it('accepts the upload key by SHA-256', () => {
    expect(signingVerdict({ sha256: [CHAKUSA_SIGNING_CERTIFICATES.sha256[0]], sha1: [] })).toBe('genuine');
  });

  it('accepts a Google Play install by its app-signing SHA-1', () => {
    expect(signingVerdict({ sha256: ['FF:FF'], sha1: ['42:31:19:EE:30:10:8C:7D:B7:CD:01:7E:37:C1:4B:2B:85:F4:78:08'] })).toBe('genuine');
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
