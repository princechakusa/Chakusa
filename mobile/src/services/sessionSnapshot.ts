import * as SecureStore from 'expo-secure-store';

// Last-known signed-in profile, kept in the device keychain/keystore so a
// returning user opens straight into the app while the server confirms the
// session in the background (the API can take seconds to wake). It grants
// nothing: every request still carries the real token, and an unauthorized
// answer clears both the session and this snapshot.
//
// SecureStore values are size-limited on some devices, so the JSON is split
// into chunks.

const CHUNK = 1800;
const MAX_CHUNKS = 8;
type Scope = 'business' | 'customer';
const key = (scope: Scope, part: number | 'n') => `chakusa.snapshot.${scope}.${part}`;

export async function writeSessionSnapshot(scope: Scope, value: unknown): Promise<void> {
  try {
    const json = JSON.stringify(value);
    const parts = Math.ceil(json.length / CHUNK);
    if (!parts || parts > MAX_CHUNKS) { await clearSessionSnapshot(scope); return; }
    for (let i = 0; i < parts; i += 1) await SecureStore.setItemAsync(key(scope, i), json.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(key(scope, 'n'), String(parts));
  } catch {
    /* best-effort: without a snapshot, restore simply waits for the server */
  }
}

export async function readSessionSnapshot<T>(scope: Scope): Promise<T | null> {
  try {
    const parts = Number(await SecureStore.getItemAsync(key(scope, 'n')));
    if (!Number.isInteger(parts) || parts < 1 || parts > MAX_CHUNKS) return null;
    let json = '';
    for (let i = 0; i < parts; i += 1) {
      const chunk = await SecureStore.getItemAsync(key(scope, i));
      if (chunk == null) return null;
      json += chunk;
    }
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function clearSessionSnapshot(scope: Scope): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key(scope, 'n'));
    await Promise.all(Array.from({ length: MAX_CHUNKS }, (_, i) => SecureStore.deleteItemAsync(key(scope, i)).catch(() => undefined)));
  } catch {
    /* nothing to clear */
  }
}
