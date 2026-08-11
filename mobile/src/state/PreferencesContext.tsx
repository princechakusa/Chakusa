import * as SecureStore from 'expo-secure-store';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

export type BusinessGoal = 'missed_calls' | 'reviews' | 'comebacks';
export interface AttentionPreferences { missedCalls: boolean; reviews: boolean; comebacks: boolean; businessActivity: boolean; }
interface StoredPreferences { onboardingStep: number; onboardingComplete: boolean; goals: BusinessGoal[]; industry: string; attention: AttentionPreferences; }
interface PreferencesValue extends StoredPreferences { restoring: boolean; setOnboardingStep: (step: number) => void; setGoals: (goals: BusinessGoal[]) => void; setIndustry: (industry: string) => void; setAttention: (attention: AttentionPreferences) => void; completeOnboarding: () => void; resetOnboarding: () => void; }
const STORAGE_KEY = 'chakusa.preferences.v1';
const defaults: StoredPreferences = { onboardingStep: 0, onboardingComplete: false, goals: [], industry: '', attention: { missedCalls: true, reviews: true, comebacks: true, businessActivity: true } };
const PreferencesContext = createContext<PreferencesValue | null>(null);

async function readPreferences() { const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(STORAGE_KEY) : await SecureStore.getItemAsync(STORAGE_KEY); if (!raw) return defaults; try { const saved = JSON.parse(raw) as Partial<StoredPreferences>; return { ...defaults, ...saved, attention: { ...defaults.attention, ...saved.attention } }; } catch { return defaults; } }
async function writePreferences(value: StoredPreferences) { const raw = JSON.stringify(value); if (Platform.OS === 'web') globalThis.localStorage?.setItem(STORAGE_KEY, raw); else await SecureStore.setItemAsync(STORAGE_KEY, raw); }

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [restoring, setRestoring] = useState(true); const [preferences, setPreferences] = useState<StoredPreferences>(defaults);
  useEffect(() => { void readPreferences().then(value => { setPreferences(value); setRestoring(false); }); }, []);
  useEffect(() => { if (!restoring) void writePreferences(preferences); }, [preferences, restoring]);
  const value = useMemo<PreferencesValue>(() => ({ ...preferences, restoring, setOnboardingStep: onboardingStep => setPreferences(current => ({ ...current, onboardingStep })), setGoals: goals => setPreferences(current => ({ ...current, goals })), setIndustry: industry => setPreferences(current => ({ ...current, industry })), setAttention: attention => setPreferences(current => ({ ...current, attention })), completeOnboarding: () => setPreferences(current => ({ ...current, onboardingStep: 0, onboardingComplete: true })), resetOnboarding: () => setPreferences(defaults) }), [preferences, restoring]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export function usePreferences() { const value = useContext(PreferencesContext); if (!value) throw new Error('usePreferences must be used within PreferencesProvider'); return value; }
