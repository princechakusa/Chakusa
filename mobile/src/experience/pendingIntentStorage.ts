import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Experience } from './experience';
import {
  PENDING_INTENT_KEY,
  PendingIntent,
  parsePendingIntent,
  serializePendingIntent,
} from './pendingIntent';

// PROGRAM 2 LOOP 10: persistence for the pending intent. Kept separate
// from the pure `pendingIntent.ts` so that module stays unit-testable
// without pulling in react-native / expo. Stores no token — only the
// validated destination produced by the normalisers.

async function readRaw(): Promise<string | null> {
  try {
    return Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(PENDING_INTENT_KEY) ?? null
      : await SecureStore.getItemAsync(PENDING_INTENT_KEY);
  } catch { return null; }
}

export async function writePendingIntent(intent: PendingIntent): Promise<void> {
  try {
    const value = serializePendingIntent(intent);
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(PENDING_INTENT_KEY, value);
    else await SecureStore.setItemAsync(PENDING_INTENT_KEY, value);
  } catch { /* best-effort */ }
}

export async function clearPendingIntent(): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(PENDING_INTENT_KEY);
    else await SecureStore.deleteItemAsync(PENDING_INTENT_KEY);
  } catch { /* ignore */ }
}

/** Read + validate without consuming. Clears malformed/expired data as a side effect. */
export async function peekPendingIntent(now: number = Date.now()): Promise<PendingIntent | null> {
  const raw = await readRaw();
  if (raw == null) return null;
  const intent = parsePendingIntent(raw, now);
  if (!intent) { await clearPendingIntent(); return null; }
  return intent;
}

/**
 * Exactly-once consumption for one experience. Reads, validates that the
 * stored intent belongs to `experience`, clears storage, then returns it.
 * A second call returns null. An intent for the OTHER experience is left
 * untouched (that shell consumes it after it mounts).
 */
export async function consumePendingIntent(experience: Experience, now: number = Date.now()): Promise<PendingIntent | null> {
  const intent = await peekPendingIntent(now);
  if (!intent) return null;
  if (intent.experience !== experience) return null;
  await clearPendingIntent();
  return intent;
}
