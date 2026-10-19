import { describe, expect, it } from 'vitest';
import { authenticationEntry, authenticationRoutes, emailPasswordProblem, hasCompletedBusinessSetup, registrationInput } from './authenticationFlow';

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
  it('routes an onboarded owner with a pending legal document to legalAcceptance instead of Main', () => expect(authenticationRoutes('authenticated', true, true)).toMatchObject({ main: false, onboarding: false, legalAcceptance: true }));
  it('defaults to no pending legal acceptance so every pre-existing caller is unaffected', () => expect(authenticationRoutes('authenticated', true)).toMatchObject({ main: true, legalAcceptance: false }));
  it('never shows legalAcceptance before business onboarding is complete, onboarding still takes priority', () => expect(authenticationRoutes('authenticated', false, true)).toMatchObject({ onboarding: true, legalAcceptance: false, main: false }));
});

describe('email + password form validation', () => {
  const ok = { email: 'owner@example.com', password: 'correct horse', fullName: 'Ada', businessName: 'Ada Studio' };
  it('accepts a complete sign-in and sign-up', () => {
    expect(emailPasswordProblem({ ...ok, registering: false })).toBeNull();
    expect(emailPasswordProblem({ ...ok, registering: true, needsBusinessName: true })).toBeNull();
  });
  it('asks for a valid email and a password', () => {
    expect(emailPasswordProblem({ ...ok, email: '  ', registering: false })).toBe('Enter your email address.');
    expect(emailPasswordProblem({ ...ok, email: 'not-an-email', registering: false })).toBe('Enter a valid email address.');
    expect(emailPasswordProblem({ ...ok, password: '', registering: false })).toBe('Enter your password.');
  });
  it('does not apply the new-password length rule to sign-in', () => {
    expect(emailPasswordProblem({ ...ok, password: 'short', registering: false })).toBeNull();
  });
  it('mirrors the server rules for sign-up', () => {
    expect(emailPasswordProblem({ ...ok, password: '1234567', registering: true })).toBe('Use at least 8 characters for your password.');
    expect(emailPasswordProblem({ ...ok, fullName: ' ', registering: true })).toBe('Enter your name.');
    expect(emailPasswordProblem({ ...ok, businessName: '', registering: true, needsBusinessName: true })).toBe('Enter your business name.');
    expect(emailPasswordProblem({ ...ok, businessName: '', registering: true })).toBeNull();
  });
});
