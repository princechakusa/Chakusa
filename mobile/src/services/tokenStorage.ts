import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'chakusa.auth.session.v2';
const LEGACY_TOKEN_KEY = 'chakusa.auth.token';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

export async function getStoredSession(): Promise<StoredSession | null> {
  const raw = Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(SESSION_KEY) ?? null
    : await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    return value.accessToken && value.refreshToken
      ? { accessToken: value.accessToken, refreshToken: value.refreshToken }
      : null;
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function storeSession(session: StoredSession) {
  const value = JSON.stringify(session);
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(SESSION_KEY, value);
  else await SecureStore.setItemAsync(SESSION_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearStoredSession() {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(SESSION_KEY);
    globalThis.localStorage?.removeItem(LEGACY_TOKEN_KEY);
  } else {
    await Promise.all([
      SecureStore.deleteItemAsync(SESSION_KEY),
      SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
    ]);
  }
}
