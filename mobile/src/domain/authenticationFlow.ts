import type { BusinessDto } from '../apiTypes';

export type AuthenticationMode = 'login' | 'register';
export type AuthenticationStatus = 'restoring' | 'restore-error' | 'anonymous' | 'authenticated';

// PROGRAM 2 LOOP 4: hasPendingLegalAcceptance gates Main the same way
// onboardingComplete does - a business account with a required document it
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

/** Server minimum (auth.schemas.ts / customerAuth.schemas.ts). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Early, friendly feedback for the email + password forms. Mirrors the
 * server's zod rules; the server still validates every request.
 */
export function emailPasswordProblem(input: { email: string; password: string; registering: boolean; fullName?: string; businessName?: string; needsBusinessName?: boolean }): string | null {
  const email = input.email.trim();
  if (input.registering && !input.fullName?.trim()) return 'Enter your name.';
  if (input.registering && input.needsBusinessName && !input.businessName?.trim()) return 'Enter your business name.';
  if (!email) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!input.password) return input.registering ? 'Create a password.' : 'Enter your password.';
  if (input.registering && input.password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  return null;
}

export function hasCompletedBusinessSetup(business: BusinessDto | null) {
  return Boolean(business?.onboardingCompletedAt);
}
