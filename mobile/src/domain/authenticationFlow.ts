import type { BusinessDto } from '../apiTypes';

export type AuthenticationMode = 'login' | 'register';
export type AuthenticationStatus = 'restoring' | 'restore-error' | 'anonymous' | 'authenticated';

// PROGRAM 2 LOOP 4: hasPendingLegalAcceptance gates Main the same way
// onboardingComplete does — a business account with a required document it
// hasn't accepted yet (a first acceptance, or a mandatory re-acceptance
// after a new version publishes, see legalDocumentVersion.
// requiresReacceptance) sees LegalAcceptance instead of the dashboard.
// Optional and defaulted so every existing caller (and this file's own
// tests) that doesn't know about the Legal Platform keeps working exactly
// as before.
export function authenticationRoutes(status: AuthenticationStatus, onboardingComplete: boolean, hasPendingLegalAcceptance = false) {
  return {
    restoring: status === 'restoring',
    restoreError: status === 'restore-error',
    anonymous: status === 'anonymous',
    onboarding: (status === 'anonymous' || status === 'authenticated') && !onboardingComplete,
    legalAcceptance: status === 'authenticated' && onboardingComplete && hasPendingLegalAcceptance,
    main: status === 'authenticated' && onboardingComplete && !hasPendingLegalAcceptance,
  };
}

export function authenticationEntry(mode: AuthenticationMode) {
  return ['Login', { mode }] as const;
}

export function registrationInput(input: { email: string; password: string; fullName: string; businessName: string; defaultIndustry?: string; invitationToken?: string }) {
  const common = { email: input.email.trim(), password: input.password, fullName: input.fullName.trim() };
  return input.invitationToken
    ? { ...common, invitationToken: input.invitationToken }
    : { ...common, businessName: input.businessName.trim(), industry: input.defaultIndustry };
}

export function hasCompletedBusinessSetup(business: BusinessDto | null) {
  return Boolean(business?.onboardingCompletedAt);
}
