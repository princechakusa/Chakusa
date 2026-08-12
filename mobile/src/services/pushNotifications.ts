import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { EAS_PROJECT_ID } from '../config';
import { ApiError } from './api';
import { devicesApi } from './endpoints';

const PUSH_TOKEN_KEY = 'chakusa.push.expo-token.v1';
let registrationPromise: Promise<void> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const isExpoPushToken = (token: string) => /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token);

async function readStoredToken() {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
}

async function storeToken(token: string) {
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function clearStoredToken() {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
}

async function removeStoredToken() {
  const token = await readStoredToken();
  if (!token) return;
  try {
    await devicesApi.remove(token);
    await clearStoredToken();
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'not-found') await clearStoredToken();
  }
}

async function registerCurrentDevice() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  if (!Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.status === Notifications.PermissionStatus.UNDETERMINED) {
    permissions = await Notifications.requestPermissionsAsync();
  }
  if (permissions.status !== Notifications.PermissionStatus.GRANTED) {
    await removeStoredToken();
    return;
  }
  if (!EAS_PROJECT_ID) return;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data?.trim();
  if (!token || !isExpoPushToken(token)) {
    await removeStoredToken();
    return;
  }
  const previousToken = await readStoredToken();
  await devicesApi.register({ token, platform: Platform.OS });
  if (previousToken && previousToken !== token) {
    try { await devicesApi.remove(previousToken); } catch { /* The backend will deactivate invalid tokens on delivery. */ }
  }
  await storeToken(token);
}

export function registerCurrentDeviceForPush() {
  if (registrationPromise) return registrationPromise;
  registrationPromise = registerCurrentDevice()
    .catch(() => undefined)
    .finally(() => { registrationPromise = null; });
  return registrationPromise;
}

export async function unregisterCurrentPushToken() {
  await removeStoredToken();
}
