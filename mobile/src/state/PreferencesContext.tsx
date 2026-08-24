import * as SecureStore from 'expo-secure-store';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { BusinessGoal } from '../domain/onboarding';
import { preferenceStorageKey, scopedPreferenceState } from '../domain/preferenceScope';

export type { BusinessGoal };
// Not synced to the backend — nothing consumes it yet beyond onboarding
// itself. It exists so future personalization (e.g. nudging larger teams
// toward the Business tier) has the signal available without requiring a
// business-record schema change before there's a real feature behind it.
export type TeamSize = 'just_me' | 'small' | 'medium' | 'large';
export interface AttentionPreferences { missedCalls: boolean; reviews: boolean; comebacks: boolean; businessActivity: boolean; }
export interface StoredPreferences { onboardingStep: number; onboardingComplete: boolean; goals: BusinessGoal[]; industry: string; teamSize: TeamSize | null; attention: AttentionPreferences; }
interface PreferencesValue extends StoredPreferences { restoring: boolean; activateScope: (userId: string | null, onboardingComplete: boolean, industry?: string | null) => Promise<void>; setOnboardingStep: (step: number) => void; setGoals: (goals: BusinessGoal[]) => void; setIndustry: (industry: string) => void; setTeamSize: (teamSize: TeamSize) => void; setAttention: (attention: AttentionPreferences) => void; completeOnboarding: () => void; resetOnboarding: () => void; }
const defaults: StoredPreferences = { onboardingStep: 0, onboardingComplete: false, goals: [], industry: '', teamSize: null, attention: { missedCalls: true, reviews: true, comebacks: true, businessActivity: true } };
const PreferencesContext = createContext<PreferencesValue | null>(null);

async function readPreferences(key: string) { const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) : await SecureStore.getItemAsync(key); if (!raw) return defaults; try { const saved = JSON.parse(raw) as Partial<StoredPreferences>; return { ...defaults, ...saved, attention: { ...defaults.attention, ...saved.attention } }; } catch { return defaults; } }
async function writePreferences(key: string, value: StoredPreferences) { const raw = JSON.stringify(value); if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, raw); else await SecureStore.setItemAsync(key, raw); }

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [restoring, setRestoring] = useState(true); const [activeStorageKey, setActiveStorageKey] = useState(preferenceStorageKey(null)); const [preferences, setPreferences] = useState<StoredPreferences>(defaults);
  useEffect(() => { void readPreferences(preferenceStorageKey(null)).then(value => { setPreferences(value); setRestoring(false); }); }, []);
  useEffect(() => { if (!restoring) void writePreferences(activeStorageKey, preferences); }, [activeStorageKey, preferences, restoring]);
  const value = useMemo<PreferencesValue>(() => ({ ...preferences, restoring,
    activateScope: async (userId, onboardingComplete, industry) => {
      const key = preferenceStorageKey(userId); setRestoring(true); const saved = await readPreferences(key);
      setActiveStorageKey(key); setPreferences(scopedPreferenceState(saved, userId, onboardingComplete, industry)); setRestoring(false);
    },
    setOnboardingStep: onboardingStep => setPreferences(current => ({ ...current, onboardingStep })), setGoals: goals => setPreferences(current => ({ ...current, goals })), setIndustry: industry => setPreferences(current => ({ ...current, industry })), setTeamSize: teamSize => setPreferences(current => ({ ...current, teamSize })), setAttention: attention => setPreferences(current => ({ ...current, attention })), completeOnboarding: () => setPreferences(current => ({ ...current, onboardingStep: 0, onboardingComplete: true })), resetOnboarding: () => setPreferences(defaults) }), [activeStorageKey, preferences, restoring]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export function usePreferences() { const value = useContext(PreferencesContext); if (!value) throw new Error('usePreferences must be used within PreferencesProvider'); return value; }
