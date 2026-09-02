import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// PROGRAM 2 LOOP 7: customer session storage. Deliberately NAMESPACED away
// from the business session (`chakusa.auth.session.v2`) — the two token
// stores never touch. A customer build reads/writes only these keys; a
// business build reads/writes only its own. See CUSTOMER_APP.md.

const CUSTOMER_SESSION_KEY = 'chakusa.customer.session.v1';

export interface CustomerStoredSession {
  accessToken: string;
  refreshToken: string;
}

export async function getCustomerSession(): Promise<CustomerStoredSession | null> {
  const raw = Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(CUSTOMER_SESSION_KEY) ?? null
    : await SecureStore.getItemAsync(CUSTOMER_SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CustomerStoredSession>;
    return value.accessToken && value.refreshToken
      ? { accessToken: value.accessToken, refreshToken: value.refreshToken }
      : null;
  } catch {
    await clearCustomerSession();
    return null;
  }
}

export async function storeCustomerSession(session: CustomerStoredSession) {
  const value = JSON.stringify(session);
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(CUSTOMER_SESSION_KEY, value);
  else await SecureStore.setItemAsync(CUSTOMER_SESSION_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearCustomerSession() {
  if (Platform.OS === 'web') globalThis.localStorage?.removeItem(CUSTOMER_SESSION_KEY);
  else await SecureStore.deleteItemAsync(CUSTOMER_SESSION_KEY);
}
