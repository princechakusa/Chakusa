import { Platform } from 'react-native';
import { APPROVED_PUBLIC_DESTINATIONS } from './domain/trustSettings';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

export const API_URL = configuredUrl || 'http://localhost:4000';

export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ?? '';
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
export const APPLE_PRO_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_APPLE_PRO_MONTHLY_PRODUCT_ID?.trim() ?? '';
export const GOOGLE_PRO_MONTHLY_PRODUCT_ID = process.env.EXPO_PUBLIC_GOOGLE_PRO_MONTHLY_PRODUCT_ID?.trim() ?? '';
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
