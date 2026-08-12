import { Platform } from 'react-native';

const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

export const API_URL = configuredUrl || 'http://localhost:4000';

export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ?? '';
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';

export const apiEnvironmentHint = Platform.select({
  ios: 'For a physical iPhone, set EXPO_PUBLIC_API_URL to this computer\'s LAN address.',
  android: 'For an Android emulator, set EXPO_PUBLIC_API_URL to http://10.0.2.2:4000.',
  default: undefined,
});
