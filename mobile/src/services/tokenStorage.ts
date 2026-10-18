import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'chakusa.auth.session.v2';
const LEGACY_TOKEN_KEY = 'chakusa.auth.token';
let revision = 0;
let pendingWrite: Promise<unknown> = Promise.resolve();
export function businessSessionRevision() { return revision; }
function persist(action: () => Promise<void>) {
  const pending = pendingWrite.then(action);
  pendingWrite = pending.catch(() => undefined);
  return pending;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  ownerUserId?: string;
  ownerBusinessId?: string;
}

export async function getStoredSession(): Promise<StoredSession | null> {
  await pendingWrite;
  const raw = Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(SESSION_KEY) ?? null
    : await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredSession>;
    return value.accessToken && value.refreshToken
      ? { accessToken: value.accessToken, refreshToken: value.refreshToken,
        ownerUserId: typeof value.ownerUserId === 'string' ? value.ownerUserId : undefined,
        ownerBusinessId: typeof value.ownerBusinessId === 'string' ? value.ownerBusinessId : undefined }
      : null;
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function storeSession(session: StoredSession, expectedRevision?: number) {
  if (expectedRevision !== undefined && expectedRevision !== revision) throw new Error('Session changed');
  revision++;
  const value = JSON.stringify(session);
  return persist(async () => {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(SESSION_KEY, value);
    else await SecureStore.setItemAsync(SESSION_KEY, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });
}

export async function clearStoredSession() {
  revision++;
  return persist(async () => { if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(SESSION_KEY);
    globalThis.localStorage?.removeItem(LEGACY_TOKEN_KEY);
  } else {
    await Promise.all([
      SecureStore.deleteItemAsync(SESSION_KEY),
      SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
    ]);
  } });
}
