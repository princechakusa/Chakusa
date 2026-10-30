import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { aiConsentStorageKey, type AiDataSharingKey } from '../domain/aiDataSharing';

// Remembers that this signed-in person agreed to the AI data-sharing
// disclosure on this device. Holds only the string '1' - no token, no data.
// A failed read counts as "not agreed", so the disclosure shows again.

export async function hasAiConsent(key: AiDataSharingKey, userId: string): Promise<boolean> {
  const storageKey = aiConsentStorageKey(key, userId);
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(storageKey) ?? null : await SecureStore.getItemAsync(storageKey);
    return raw === '1';
  } catch {
    return false;
  }
}

export async function recordAiConsent(key: AiDataSharingKey, userId: string): Promise<void> {
  const storageKey = aiConsentStorageKey(key, userId);
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(storageKey, '1');
    else await SecureStore.setItemAsync(storageKey, '1');
  } catch {
    /* best-effort; the disclosure simply shows again next time */
  }
}
