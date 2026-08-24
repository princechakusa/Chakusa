import { describe, expect, it } from 'vitest';
import { authenticationEntry, authenticationRoutes, hasCompletedBusinessSetup, registrationInput } from './authenticationFlow';

describe('authentication flow', () => {
  it('opens the redesigned form in login mode', () => expect(authenticationEntry('login')).toEqual(['Login', { mode: 'login' }]));
  it('opens the redesigned form in register mode', () => expect(authenticationEntry('register')).toEqual(['Login', { mode: 'register' }]));
  it('routes an existing owner to Main', () => expect(authenticationRoutes('authenticated', true)).toMatchObject({ main: true, onboarding: false, anonymous: false }));
  it('routes a new owner to onboarding', () => expect(authenticationRoutes('authenticated', false)).toMatchObject({ main: false, onboarding: true, anonymous: false }));
  it('keeps session restore in the restoring state', () => expect(authenticationRoutes('restoring', false)).toMatchObject({ restoring: true, anonymous: false, onboarding: false, main: false }));
  it('preserves restore errors outside authenticated routes', () => expect(authenticationRoutes('restore-error', false)).toMatchObject({ restoreError: true, anonymous: false, onboarding: false, main: false }));
  it('keeps invitation registration token-scoped', () => expect(registrationInput({ email: ' invited@example.com ', password: 'secret', fullName: ' Invited User ', businessName: 'Ignored', defaultIndustry: 'salon', invitationToken: 'invite-token' })).toEqual({ email: 'invited@example.com', password: 'secret', fullName: 'Invited User', invitationToken: 'invite-token' }));
  it('builds new-owner registration details', () => expect(registrationInput({ email: ' owner@example.com ', password: 'secret', fullName: ' Owner ', businessName: ' Studio ', defaultIndustry: 'salon' })).toEqual({ email: 'owner@example.com', password: 'secret', fullName: 'Owner', businessName: 'Studio', industry: 'salon' }));
  it('recognises an explicitly completed business setup', () => expect(hasCompletedBusinessSetup({ onboardingCompletedAt: '2026-08-24T12:00:00.000Z' } as never)).toBe(true));
  it('does not infer completion from partial business fields', () => expect(hasCompletedBusinessSetup({ name: 'Studio', phone: '+15551234567', defaultServices: ['Haircut'], onboardingCompletedAt: null } as never)).toBe(false));
});
