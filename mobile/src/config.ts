import { Platform } from 'react-native';
import { APPROVED_PUBLIC_DESTINATIONS } from './domain/trustSettings';
import { normalizeApiUrl, publicFeatureEnabled, socialSignInProviders } from './domain/mobileProduction';
import type { BuildDefaults, EffectiveConfig } from './domain/runtimeConfig';

const configuredUrl = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL);

// PROGRAM 2 LOOP 9: production Chakusa is ONE app and chooses the
// customer/business experience at RUNTIME (see src/experience/). This
// build-time flag is now only an INTERNAL DEVELOPMENT OVERRIDE: setting
// EXPO_PUBLIC_APP_VARIANT=customer forces the customer shell for focused
// QA / storybook-style builds. Unset (the default for every production and
// CI build) means "let the ExperienceRouter decide". Production must never
// depend on this. See CUSTOMER_APP.md.
export type AppVariant = 'business' | 'customer';
const rawVariant = process.env.EXPO_PUBLIC_APP_VARIANT?.trim().toLowerCase();
export const APP_VARIANT: AppVariant = rawVariant === 'customer' ? 'customer' : 'business';

// Required per build/environment through the process, EAS, or CI secret manager.
// There is deliberately no repository file or source fallback.
export const API_URL = configuredUrl;
export let GOOGLE_AUTH_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED);
export let APPLE_AUTH_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED);
export let EMAIL_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_EMAIL_ENABLED ?? process.env.EXPO_PUBLIC_PASSWORD_RESET_EMAIL_ENABLED);
export let PASSWORD_RESET_EMAIL_ENABLED = EMAIL_ENABLED;
export let AUTOMATION_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_AUTOMATION_ENABLED);
export let BILLING_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_BILLING_ENABLED);
export const SENTRY_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_SENTRY_ENABLED);
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? '';

export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ?? '';
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
export let SOCIAL_SIGN_IN = socialSignInProviders({ platform: Platform.OS, googleEnabled: GOOGLE_AUTH_ENABLED, googleWebClientId: GOOGLE_WEB_CLIENT_ID, appleEnabled: APPLE_AUTH_ENABLED });
export const APPLE_PRO_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_APPLE_PRO_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const GOOGLE_PRO_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_GOOGLE_PRO_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const APPLE_BUSINESS_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_APPLE_BUSINESS_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID?.trim() ?? '';
export let PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() || APPROVED_PUBLIC_DESTINATIONS.privacy;
export let TERMS_OF_USE_URL = process.env.EXPO_PUBLIC_TERMS_OF_USE_URL?.trim() || APPROVED_PUBLIC_DESTINATIONS.terms;
export let SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL?.trim() || APPROVED_PUBLIC_DESTINATIONS.support;
export let SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || APPROVED_PUBLIC_DESTINATIONS.supportEmail;
export const DELETE_ACCOUNT_URL = APPROVED_PUBLIC_DESTINATIONS.deleteAccount;

// Runtime configuration (services/runtimeConfig.ts). The values above are
// the BUILD defaults; the `let` exports are live ES-module bindings, so after
// applyRuntimeConfig() every importer reads the admin-controlled value on its
// next render, with no change to the importing screens. Native identifiers
// (API URL, OAuth client IDs, store product IDs, Sentry) stay build-time.
export const BUILD_DEFAULTS: BuildDefaults = {
  automation: AUTOMATION_ENABLED, billing: BILLING_ENABLED, emailAuth: EMAIL_ENABLED,
  googleSignIn: GOOGLE_AUTH_ENABLED, appleSignIn: APPLE_AUTH_ENABLED,
  supportEmail: SUPPORT_EMAIL, supportUrl: SUPPORT_URL, privacyUrl: PRIVACY_POLICY_URL, termsUrl: TERMS_OF_USE_URL,
};

export function applyRuntimeConfig(c: EffectiveConfig) {
  AUTOMATION_ENABLED = c.automation;
  BILLING_ENABLED = c.billing;
  EMAIL_ENABLED = c.emailAuth;
  PASSWORD_RESET_EMAIL_ENABLED = c.emailAuth;
  GOOGLE_AUTH_ENABLED = c.googleSignIn;
  APPLE_AUTH_ENABLED = c.appleSignIn;
  SOCIAL_SIGN_IN = socialSignInProviders({ platform: Platform.OS, googleEnabled: GOOGLE_AUTH_ENABLED, googleWebClientId: GOOGLE_WEB_CLIENT_ID, appleEnabled: APPLE_AUTH_ENABLED });
  SUPPORT_EMAIL = c.supportEmail;
  SUPPORT_URL = c.supportUrl;
  PRIVACY_POLICY_URL = c.privacyUrl;
  TERMS_OF_USE_URL = c.termsUrl;
}

export const apiEnvironmentHint = Platform.select({
  ios: 'For a physical iPhone, set EXPO_PUBLIC_API_URL to this computer\'s LAN address.',
  android: 'For an Android emulator, set EXPO_PUBLIC_API_URL to http://10.0.2.2:4000.',
  default: undefined,
});
