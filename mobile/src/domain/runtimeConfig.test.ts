import { describe, expect, it } from 'vitest';
import { compareVersions, copyrightLine, mergeConfig, parseRemoteConfig, updateRequired, type BuildDefaults } from './runtimeConfig';

const build: BuildDefaults = {
  automation: false, billing: true, emailAuth: false, googleSignIn: true, appleSignIn: false,
  supportEmail: 'support@chakusarecovery.com', supportUrl: 'https://chakusarecovery.com/help',
  privacyUrl: 'https://chakusarecovery.com/privacy', termsUrl: 'https://chakusarecovery.com/terms',
};

describe('runtime config', () => {
  it('keeps build values when there is no remote config', () => {
    const c = mergeConfig(build, null);
    expect(c).toMatchObject({ ...build, notice: null, maintenance: false, minSupportedVersion: null, iosStoreUrl: null });
  });

  it('lets the server turn product switches on or off', () => {
    const remote = parseRemoteConfig({ schemaVersion: 1, features: { automation: true, billing: false, emailAuth: true } });
    expect(mergeConfig(build, remote)).toMatchObject({ automation: true, billing: false, emailAuth: true });
  });

  it('lets the server only hide native sign-in, never add it to a build without it', () => {
    const remote = parseRemoteConfig({ schemaVersion: 1, features: { googleSignIn: false, appleSignIn: true } });
    const c = mergeConfig(build, remote);
    expect(c.googleSignIn).toBe(false);
    expect(c.appleSignIn).toBe(false); // build has no Apple configuration
  });

  it('ignores unsafe or malformed links and keeps the build default', () => {
    const remote = parseRemoteConfig({ schemaVersion: 1, links: { privacyUrl: 'http://chakusarecovery.com/privacy', termsUrl: 'javascript:alert(1)', supportEmail: 'nope', supportUrl: 'https://chakusarecovery.com/support' } });
    const c = mergeConfig(build, remote);
    expect(c.privacyUrl).toBe(build.privacyUrl);
    expect(c.termsUrl).toBe(build.termsUrl);
    expect(c.supportEmail).toBe(build.supportEmail);
    expect(c.supportUrl).toBe('https://chakusarecovery.com/support');
  });

  it('rejects payloads that are not schema v1 or have wrong types', () => {
    expect(parseRemoteConfig(null)).toBeNull();
    expect(parseRemoteConfig({ schemaVersion: 2, features: {} })).toBeNull();
    const c = mergeConfig(build, parseRemoteConfig({ schemaVersion: 1, features: { automation: 'yes' } }));
    expect(c.automation).toBe(false);
  });

  it('trims and caps the notice', () => {
    const c = mergeConfig(build, parseRemoteConfig({ schemaVersion: 1, app: { notice: `  ${'x'.repeat(200)}  ` } }));
    expect(c.notice).toHaveLength(160);
  });

  it('compares versions and only blocks known older versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(updateRequired('1.0.0', '1.1.0')).toBe(true);
    expect(updateRequired('1.1.0', '1.1.0')).toBe(false);
    expect(updateRequired(undefined, '1.1.0')).toBe(false);
    expect(updateRequired('1.0.0', null)).toBe(false);
    expect(updateRequired('1.0.0', 'latest')).toBe(false);
  });

  it('builds company info with safe defaults and only valid links', () => {
    const none = mergeConfig(build, null).company;
    expect(none).toMatchObject({ websiteUrl: 'https://chakusarecovery.com', copyrightHolder: 'Chakusa', copyrightStartYear: 2026, whatsappUrl: null, socialLinks: [] });
    const c = mergeConfig(build, parseRemoteConfig({ schemaVersion: 1, company: { legalName: 'Chakusa (Pvt) Ltd', copyrightStartYear: 2025 }, social: { whatsappNumber: '+263771234567', instagramUrl: 'https://instagram.com/chakusa', facebookUrl: 'http://facebook.com/x' } })).company;
    expect(c.legalName).toBe('Chakusa (Pvt) Ltd');
    expect(c.whatsappUrl).toBe('https://wa.me/263771234567');
    expect(c.socialLinks).toEqual([{ label: 'Instagram', url: 'https://instagram.com/chakusa' }]);
  });

  it('computes the copyright range from the current year', () => {
    expect(copyrightLine({ copyrightHolder: 'Chakusa', copyrightStartYear: 2026 }, new Date('2026-05-01'))).toBe('© 2026 Chakusa');
    expect(copyrightLine({ copyrightHolder: 'Chakusa', copyrightStartYear: 2026 }, new Date('2028-01-02'))).toBe('© 2026–2028 Chakusa');
  });
});
