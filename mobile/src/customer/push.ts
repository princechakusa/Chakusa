import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { EAS_PROJECT_ID } from '../config';
import { ApiError } from '../services/api';
import { customerAuthApi } from './endpoints';

// PROGRAM 2 LOOP 7: customer push-token registration. A parallel of
// `src/services/pushNotifications.ts` bound to the customer device routes
// and its own storage key, so a customer build's token is registered
// against `/customer/auth/devices` and never mixed with a business token.
// Deep-link handling itself is pure and lives in `domain/customerNav.ts`.

const PUSH_TOKEN_KEY = 'chakusa.customer.push.expo-token.v1';
const isExpoPushToken = (token: string) => /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token);

async function readStoredToken() {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
}
async function storeToken(token: string) {
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
async function clearStoredToken() {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
}

export async function removeCustomerPushToken() {
  const token = await readStoredToken();
  if (!token) return;
  try { await customerAuthApi.removeDevice(token); await clearStoredToken(); }
  catch (error) { if (error instanceof ApiError && error.kind === 'not-found') await clearStoredToken(); }
}

export type CustomerPushResult = 'registered' | 'denied' | 'unsupported' | 'not-configured';

/** Requests permission (if still undetermined), then registers the Expo token for this customer. */
export async function enableCustomerPush(): Promise<CustomerPushResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  if (!Device.isDevice) return 'unsupported';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.status === Notifications.PermissionStatus.UNDETERMINED) {
    permissions = await Notifications.requestPermissionsAsync();
  }
  if (permissions.status !== Notifications.PermissionStatus.GRANTED) {
    await removeCustomerPushToken();
    return 'denied';
  }
  if (!EAS_PROJECT_ID) return 'not-configured';

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data?.trim();
  if (!token || !isExpoPushToken(token)) { await removeCustomerPushToken(); return 'not-configured'; }

  const previousToken = await readStoredToken();
  await customerAuthApi.registerDevice(token, Platform.OS);
  if (previousToken && previousToken !== token) {
    try { await customerAuthApi.removeDevice(previousToken); } catch { /* backend deactivates stale tokens on delivery */ }
  }
  await storeToken(token);
  return 'registered';
}

export async function getCustomerPushStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  if (!Device.isDevice) return 'unsupported';
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (permissions.status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}
