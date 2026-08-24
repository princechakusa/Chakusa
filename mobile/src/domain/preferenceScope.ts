export interface ScopedPreferenceState {
  onboardingStep: number;
  onboardingComplete: boolean;
  industry: string;
}

const STORAGE_PREFIX = 'chakusa.preferences.v2';

export const preferenceStorageKey = (userId: string | null) => `${STORAGE_PREFIX}.${userId ?? 'anonymous'}`;

export function scopedPreferenceState<T extends ScopedPreferenceState>(saved: T, userId: string | null, onboardingComplete: boolean, industry?: string | null): T {
  return { ...saved, onboardingComplete, onboardingStep: onboardingComplete ? 0 : userId ? Math.max(2, saved.onboardingStep) : saved.onboardingStep, industry: saved.industry || industry || '' };
}
