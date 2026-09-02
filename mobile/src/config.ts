import { Platform } from 'react-native';
import { APPROVED_PUBLIC_DESTINATIONS } from './domain/trustSettings';
import { normalizeApiUrl, publicFeatureEnabled } from './domain/mobileProduction';

const configuredUrl = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL);

// PROGRAM 2 LOOP 7: which application this build is. 'business' is the
// long-standing owner app and the default when nothing is set, so every
// existing build and every existing test keeps its exact behaviour. A
// build sets EXPO_PUBLIC_APP_VARIANT=customer (see eas.json `customer`
// profile) to boot the customer shell instead. See CUSTOMER_APP.md.
export type AppVariant = 'business' | 'customer';
const rawVariant = process.env.EXPO_PUBLIC_APP_VARIANT?.trim().toLowerCase();
export const APP_VARIANT: AppVariant = rawVariant === 'customer' ? 'customer' : 'business';

// Required per build/environment through the process, EAS, or CI secret manager.
// There is deliberately no repository file or source fallback.
export const API_URL = configuredUrl;
export const GOOGLE_AUTH_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED);
export const APPLE_AUTH_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_APPLE_AUTH_ENABLED);
export const EMAIL_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_EMAIL_ENABLED ?? process.env.EXPO_PUBLIC_PASSWORD_RESET_EMAIL_ENABLED);
export const PASSWORD_RESET_EMAIL_ENABLED = EMAIL_ENABLED;
export const AUTOMATION_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_AUTOMATION_ENABLED);
export const BILLING_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_BILLING_ENABLED);
export const SENTRY_ENABLED = publicFeatureEnabled(process.env.EXPO_PUBLIC_SENTRY_ENABLED);
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? '';

export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ?? '';
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
export const APPLE_PRO_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_APPLE_PRO_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const GOOGLE_PRO_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_GOOGLE_PRO_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const APPLE_BUSINESS_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_APPLE_BUSINESS_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() || APPROVED_PUBLIC_DESTINATIONS.privacy;
export const TERMS_OF_USE_URL = process.env.EXPO_PUBLIC_TERMS_OF_USE_URL?.trim() || APPROVED_PUBLIC_DESTINATIONS.terms;
export const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL?.trim() || APPROVED_PUBLIC_DESTINATIONS.support;
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || APPROVED_PUBLIC_DESTINATIONS.supportEmail;
export const DELETE_ACCOUNT_URL = APPROVED_PUBLIC_DESTINATIONS.deleteAccount;

export const apiEnvironmentHint = Platform.select({
  ios: 'For a physical iPhone, set EXPO_PUBLIC_API_URL to this computer\'s LAN address.',
  android: 'For an Android emulator, set EXPO_PUBLIC_API_URL to http://10.0.2.2:4000.',
  default: undefined,
});
