import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthResponse, BusinessDto, UserDto } from '../apiTypes';
import { ApiError, setUnauthorizedHandler } from '../services/api';
import { authApi, businessApi } from '../services/endpoints';
import { clearStoredSession, getStoredSession, storeSession } from '../services/tokenStorage';
import { requestGoogleIdToken } from '../services/googleAuth';
import { requestAppleCredential } from '../services/appleAuth';
import { unregisterCurrentPushToken } from '../services/pushNotifications';
import { usePreferences } from './PreferencesContext';

type AuthStatus = 'restoring' | 'restore-error' | 'anonymous' | 'authenticated';
interface AuthValue {
  status: AuthStatus; restoreError: string | null; user: UserDto | null; business: BusinessDto | null; role: string | null; isOnboarded: boolean;
  restore: () => Promise<void>; login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; fullName: string; businessName: string; industry?: string }) => Promise<void>;
  googleSignIn: () => Promise<boolean>; linkGoogle: () => Promise<boolean>;
  appleSignIn: () => Promise<boolean>; linkApple: () => Promise<boolean>;
  logout: () => Promise<void>; logoutAll: () => Promise<void>; forgotPassword: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>; deleteAccount: (password: string) => Promise<void>;
  deleteAccountWithGoogle: () => Promise<boolean>;
  deleteAccountWithApple: () => Promise<boolean>;
  refreshBusiness: () => Promise<BusinessDto>;
}
const AuthContext = createContext<AuthValue | null>(null);
const hasCompletedBusinessSetup = (business: BusinessDto | null) => Boolean(
  business && Array.isArray(business.defaultServices) && business.defaultServices.length > 0 && business.workingHours,
);
const unregisterPushBeforeLogout = () => Promise.race([
  unregisterCurrentPushToken(),
  new Promise<void>(resolve => setTimeout(resolve, 1500)),
]);

export function AuthProvider({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  const preferencesRef = useRef(preferences);
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const clearSession = useCallback(async () => {
    await clearStoredSession(); setUser(null); setBusiness(null); setRole(null); setStatus('anonymous');
  }, []);
  const reconcileOnboarding = useCallback((nextBusiness: BusinessDto | null) => {
    const current = preferencesRef.current;
    if (hasCompletedBusinessSetup(nextBusiness)) {
      if (!current.onboardingComplete) current.completeOnboarding();
    } else if (current.onboardingComplete) {
      current.resetOnboarding();
      current.setOnboardingStep(4);
    }
  }, []);
  const applySession = useCallback(async (response: AuthResponse) => {
    reconcileOnboarding(response.business);
    await storeSession({ accessToken: response.accessToken, refreshToken: response.refreshToken });
    setUser(response.user); setBusiness(response.business); setRole(response.role ?? null); setStatus('authenticated');
  }, [reconcileOnboarding]);

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => { setUnauthorizedHandler(clearSession); return () => setUnauthorizedHandler(undefined); }, [clearSession]);
  const restore = useCallback(async () => {
    setStatus('restoring'); setRestoreError(null);
    if (!await getStoredSession()) { setStatus('anonymous'); return; }
    try {
      const me = await authApi.me(); reconcileOnboarding(me.business); setUser(me.user); setBusiness(me.business); setRole(me.role); setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') return;
      setRestoreError(error instanceof ApiError ? error.message : 'Unable to restore your session.'); setStatus('restore-error');
    }
  }, [reconcileOnboarding]);
  useEffect(() => { void restore(); }, [restore]);

  const value = useMemo<AuthValue>(() => ({
    status, restoreError, user, business, role, restore,
    isOnboarded: hasCompletedBusinessSetup(business),
    login: async (email, password) => applySession(await authApi.login({ email, password })),
    register: async input => applySession(await authApi.register(input)),
    googleSignIn: async () => { const idToken = await requestGoogleIdToken(); if (!idToken) return false; await applySession(await authApi.google(idToken)); return true; },
    linkGoogle: async () => { const idToken = await requestGoogleIdToken({ fresh: true }); if (!idToken) return false; await authApi.linkGoogle(idToken); setUser(current => current ? { ...current, authProviders: [...new Set([...(current.authProviders ?? []), 'GOOGLE' as const])] } : current); return true; },
    appleSignIn: async () => { const challenge = await authApi.appleChallenge(); const credential = await requestAppleCredential(challenge); if (!credential) return false; await applySession(await authApi.apple(credential)); return true; },
    linkApple: async () => { const challenge = await authApi.appleLinkChallenge(); const credential = await requestAppleCredential(challenge); if (!credential) return false; await authApi.linkApple(credential); setUser(current => current ? { ...current, authProviders: [...new Set([...(current.authProviders ?? []), 'APPLE' as const])] } : current); return true; },
    logout: async () => { const session = await getStoredSession(); try { await unregisterPushBeforeLogout(); } catch { /* Device removal is best effort. */ } try { if (session) await authApi.logout(session.refreshToken); } catch { /* Local sign-out must still succeed while offline. */ } finally { await clearSession(); } },
    logoutAll: async () => { try { await unregisterPushBeforeLogout(); } catch { /* Device removal must not block session revocation. */ } try { await authApi.logoutAll(); } finally { await clearSession(); } },
    forgotPassword: async email => (await authApi.forgotPassword(email)).message,
    resetPassword: async (token, password) => { const result = await authApi.resetPassword(token, password); await clearSession(); return result.message; },
    deleteAccount: async password => { await authApi.deleteAccount(password); await clearSession(); },
    deleteAccountWithGoogle: async () => { const idToken = await requestGoogleIdToken({ fresh: true }); if (!idToken) return false; await authApi.deleteAccountWithGoogle(idToken); await clearSession(); return true; },
    deleteAccountWithApple: async () => { const challenge = await authApi.appleDeleteChallenge(); const credential = await requestAppleCredential(challenge); if (!credential) return false; await authApi.deleteAccountWithApple(credential); await clearSession(); return true; },
    refreshBusiness: async () => { const next = await businessApi.get(); setBusiness(next); return next; },
  }), [applySession, business, clearSession, restore, restoreError, role, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used within AuthProvider'); return value; }
