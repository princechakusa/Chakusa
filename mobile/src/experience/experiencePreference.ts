import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { coerceExperiencePreference, Experience, EXPERIENCE_PREFERENCE_KEY, ExperienceOrUnselected } from './experience';

// PROGRAM 2 LOOP 9: persistence for the last-used experience. This is
// untrusted local UI state — it holds NO token and NO customer/business
// data, only the string 'customer' or 'business'. A corrupt or unknown
// value reads back as 'unselected' (see coerceExperiencePreference).

export async function readExperiencePreference(): Promise<ExperienceOrUnselected> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(EXPERIENCE_PREFERENCE_KEY) ?? null
      : await SecureStore.getItemAsync(EXPERIENCE_PREFERENCE_KEY);
    return coerceExperiencePreference(raw);
  } catch {
    return 'unselected';
  }
}

export async function writeExperiencePreference(experience: Experience): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(EXPERIENCE_PREFERENCE_KEY, experience);
    else await SecureStore.setItemAsync(EXPERIENCE_PREFERENCE_KEY, experience);
  } catch {
    /* best-effort; the app still works, it just won't remember the choice */
  }
}

export async function clearExperiencePreference(): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(EXPERIENCE_PREFERENCE_KEY);
    else await SecureStore.deleteItemAsync(EXPERIENCE_PREFERENCE_KEY);
  } catch {
    /* ignore */
  }
}
