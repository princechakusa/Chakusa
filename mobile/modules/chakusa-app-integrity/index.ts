import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface SigningInfo {
  /** Colon-separated upper-case hex fingerprints of the signing certificate(s). */
  sha256: string[];
  sha1: string[];
  /** Package that installed the app (e.g. com.android.vending for Google Play), or null for sideloads. */
  installer: string | null;
}

interface ChakusaAppIntegrityNativeModule {
  getSigningInfo(): SigningInfo | null;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<ChakusaAppIntegrityNativeModule>('ChakusaAppIntegrity') : null;

/** Null when the platform or build has no native module (iOS, web, Expo Go). */
export function getSigningInfo(): SigningInfo | null {
  try {
    return native?.getSigningInfo() ?? null;
  } catch {
    return null;
  }
}
