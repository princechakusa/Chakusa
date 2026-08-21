import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { MilestoneKey } from '../domain/milestones';

const STORAGE_KEY = 'chakusa.milestones.seen.v1';

async function readRaw(): Promise<string | null> {
  return Platform.OS === 'web' ? globalThis.localStorage?.getItem(STORAGE_KEY) ?? null : SecureStore.getItemAsync(STORAGE_KEY);
}
async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(STORAGE_KEY, value);
  else await SecureStore.setItemAsync(STORAGE_KEY, value);
}

/** Which milestone celebrations have already been shown on this device — each one shows exactly once, ever, per device. */
export async function getSeenMilestones(): Promise<Set<string>> {
  try {
    const raw = await readRaw();
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export async function markMilestonesSeen(keys: MilestoneKey[]): Promise<void> {
  if (keys.length === 0) return;
  const current = await getSeenMilestones();
  keys.forEach(key => current.add(key));
  await writeRaw(JSON.stringify([...current]));
}
