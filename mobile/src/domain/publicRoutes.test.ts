import { describe, expect, it } from 'vitest';
import { publicPageTitle, publicRouteFromPath } from './publicRoutes';

describe('public website routes', () => {
  it.each([['/privacy','privacy'],['/terms','terms'],['/support','support'],['/delete-account','delete-account']] as const)('routes %s outside authentication', (path, page) => expect(publicRouteFromPath(path)).toEqual({ kind: 'document', page }));
  it('preserves feedback tokens and malformed feedback behavior', () => { expect(publicRouteFromPath('/r/opaque-token')).toEqual({ kind: 'feedback', token: 'opaque-token' }); expect(publicRouteFromPath('/r/bad/extra')).toEqual({ kind: 'feedback', token: null }); });
  it('preserves public team invitation tokens', () => { expect(publicRouteFromPath('/team-invite/opaque-token')).toEqual({ kind: 'team-invite', token: 'opaque-token' }); expect(publicRouteFromPath('/team-invite/bad/extra')).toEqual({ kind: 'team-invite', token: null }); });
  it('preserves public business profile slugs', () => { expect(publicRouteFromPath('/b/janes-plumbing')).toEqual({ kind: 'business-profile', slug: 'janes-plumbing' }); expect(publicRouteFromPath('/b/bad/extra')).toEqual({ kind: 'business-profile', slug: null }); });
  it('does not intercept authenticated or reset-password paths', () => { expect(publicRouteFromPath('/')).toBeNull(); expect(publicRouteFromPath('/reset-password')).toBeNull(); expect(publicRouteFromPath('/dashboard')).toBeNull(); });
  it('provides approved document titles', () => { expect(publicPageTitle('privacy')).toBe('Chakusa Privacy Policy'); expect(publicPageTitle('terms')).toBe('Chakusa Terms of Use'); expect(publicPageTitle('support')).toBe('Chakusa Support'); expect(publicPageTitle('delete-account')).toBe('Delete Your Chakusa Account'); });
});
