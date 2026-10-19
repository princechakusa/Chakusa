import * as SecureStore from 'expo-secure-store';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { BusinessGoal } from '../domain/onboarding';
import { preferenceStorageKey, scopedPreferenceState } from '../domain/preferenceScope';
import { startupFallback } from '../domain/startup';

export type { BusinessGoal };
// Retained only so preferences saved by the former team-size onboarding step
// continue to deserialize safely. Current product decisions use real team data.
export type TeamSize = 'just_me' | 'small' | 'medium' | 'large';
export interface AttentionPreferences { missedCalls: boolean; reviews: boolean; comebacks: boolean; businessActivity: boolean; }
export interface StoredPreferences { onboardingStep: number; onboardingComplete: boolean; goals: BusinessGoal[]; industry: string; teamSize: TeamSize | null; attention: AttentionPreferences; }
interface PreferencesValue extends StoredPreferences { restoring: boolean; activateScope: (userId: string | null, onboardingComplete: boolean, industry?: string | null) => Promise<void>; setOnboardingStep: (step: number) => void; setGoals: (goals: BusinessGoal[]) => void; setIndustry: (industry: string) => void; setAttention: (attention: AttentionPreferences) => void; completeOnboarding: () => void; resetOnboarding: () => void; }
const defaults: StoredPreferences = { onboardingStep: 0, onboardingComplete: false, goals: [], industry: '', teamSize: null, attention: { missedCalls: true, reviews: true, comebacks: true, businessActivity: true } };
const PreferencesContext = createContext<PreferencesValue | null>(null);

async function readPreferences(key: string) {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) : await startupFallback(SecureStore.getItemAsync(key), null, 750);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<StoredPreferences>;
    return { ...defaults, ...saved, attention: { ...defaults.attention, ...saved.attention } };
  } catch { return defaults; }
}
async function writePreferences(key: string, value: StoredPreferences) { const raw = JSON.stringify(value); if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, raw); else await SecureStore.setItemAsync(key, raw); }

export function PreferencesProvider({ children }: PropsWithChildren) {
  const scopeAttempt = useRef(0);
  const [restoring, setRestoring] = useState(true); const [activeStorageKey, setActiveStorageKey] = useState(preferenceStorageKey(null)); const [preferences, setPreferences] = useState<StoredPreferences>(defaults);
  useEffect(() => { const attempt = scopeAttempt.current; void readPreferences(preferenceStorageKey(null)).then(value => { if (attempt === scopeAttempt.current) { setPreferences(value); setRestoring(false); } }); return () => { scopeAttempt.current++; }; }, []);
  useEffect(() => { if (!restoring) void writePreferences(activeStorageKey, preferences).catch(() => undefined); }, [activeStorageKey, preferences, restoring]);
  const value = useMemo<PreferencesValue>(() => ({ ...preferences, restoring,
    activateScope: async (userId, onboardingComplete, industry) => {
      const attempt = ++scopeAttempt.current;
      const key = preferenceStorageKey(userId); setRestoring(true); const saved = await readPreferences(key);
      if (attempt !== scopeAttempt.current) return;
      setActiveStorageKey(key); setPreferences(scopedPreferenceState(saved, userId, onboardingComplete, industry)); setRestoring(false);
    },
    setOnboardingStep: onboardingStep => setPreferences(current => ({ ...current, onboardingStep })), setGoals: goals => setPreferences(current => ({ ...current, goals })), setIndustry: industry => setPreferences(current => ({ ...current, industry })), setAttention: attention => setPreferences(current => ({ ...current, attention })), completeOnboarding: () => setPreferences(current => ({ ...current, onboardingStep: 0, onboardingComplete: true })), resetOnboarding: () => setPreferences(defaults) }), [activeStorageKey, preferences, restoring]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export function usePreferences() { const value = useContext(PreferencesContext); if (!value) throw new Error('usePreferences must be used within PreferencesProvider'); return value; }
