import { describe, expect, it } from 'vitest';
import { googleIosUrlScheme, normalizeApiUrl, passwordResetCopy, productionServiceAvailability, publicFeatureEnabled, renderWakeErrorCopy } from './mobileProduction';

describe('mobile production configuration', () => {
  it('normalizes production and development API URLs', () => { expect(normalizeApiUrl(' https://chakusa-api.onrender.com/ ')).toBe('https://chakusa-api.onrender.com'); expect(normalizeApiUrl('http://192.168.1.114:4000/')).toBe('http://192.168.1.114:4000'); });
  it('fails safely for missing or unsafe API URLs', () => { expect(normalizeApiUrl()).toBeNull(); expect(normalizeApiUrl('ftp://example.com')).toBeNull(); expect(normalizeApiUrl('https://user:secret@example.com')).toBeNull(); });
  it('maps disabled production services without removing their architecture', () => { expect(publicFeatureEnabled('false')).toBe(false); expect(publicFeatureEnabled(undefined)).toBe(true); expect(productionServiceAvailability(false)).toBe('unavailable'); expect(productionServiceAvailability(true)).toBe('available'); });
  it('maps the configured iOS Google client ID to its valid reversed URL scheme', () => { expect(googleIosUrlScheme('618618639466-03el8vtndca92oqjrcqv2f8uv7tqm41m.apps.googleusercontent.com')).toBe('com.googleusercontent.apps.618618639466-03el8vtndca92oqjrcqv2f8uv7tqm41m'); expect(googleIosUrlScheme()).toBeNull(); expect(googleIosUrlScheme('not-a-client-id')).toBeNull(); });
  it('uses truthful email-disabled and Render wake-up copy', () => { expect(passwordResetCopy(false)).toContain('temporarily unavailable'); expect(passwordResetCopy(true)).toContain('single-use reset link'); expect(renderWakeErrorCopy('REQUEST_TIMEOUT')).toContain('waking up'); expect(renderWakeErrorCopy()).toContain('Unable to reach'); });
});
