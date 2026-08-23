import type { BusinessDto } from '../apiTypes';

export type AuthenticationMode = 'login' | 'register';
export type AuthenticationStatus = 'restoring' | 'restore-error' | 'anonymous' | 'authenticated';

export function authenticationRoutes(status: AuthenticationStatus, onboardingComplete: boolean) {
  return {
    restoring: status === 'restoring',
    restoreError: status === 'restore-error',
    anonymous: status === 'anonymous',
    onboarding: (status === 'anonymous' || status === 'authenticated') && !onboardingComplete,
    main: status === 'authenticated' && onboardingComplete,
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
  return Boolean(business && business.name.trim() && business.phone && Array.isArray(business.defaultServices) && business.defaultServices.length > 0);
}
