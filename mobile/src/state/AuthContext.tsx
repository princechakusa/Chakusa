import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthResponse, BusinessDto, UserDto } from '../apiTypes';
import { ApiError, setUnauthorizedHandler } from '../services/api';
import { authApi, businessApi } from '../services/endpoints';
import { clearStoredSession, getStoredSession, storeSession } from '../services/tokenStorage';
import { requestGoogleIdToken } from '../services/googleAuth';
import { usePreferences } from './PreferencesContext';

type AuthStatus = 'restoring' | 'restore-error' | 'anonymous' | 'authenticated';
interface AuthValue {
  status: AuthStatus; restoreError: string | null; user: UserDto | null; business: BusinessDto | null; role: string | null; isOnboarded: boolean;
  restore: () => Promise<void>; login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; fullName: string; businessName: string; industry?: string }) => Promise<void>;
  googleSignIn: () => Promise<boolean>; linkGoogle: () => Promise<boolean>;
  logout: () => Promise<void>; logoutAll: () => Promise<void>; forgotPassword: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>; deleteAccount: (password: string) => Promise<void>;
  deleteAccountWithGoogle: () => Promise<boolean>;
  refreshBusiness: () => Promise<BusinessDto>;
}
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [business, setBusiness] = useState<BusinessDto | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const clearSession = useCallback(async () => {
    await clearStoredSession(); setUser(null); setBusiness(null); setRole(null); setStatus('anonymous');
  }, []);
  const applySession = useCallback(async (response: AuthResponse) => {
    await storeSession({ accessToken: response.accessToken, refreshToken: response.refreshToken });
    setUser(response.user); setBusiness(response.business); setRole(response.role ?? null); setStatus('authenticated');
  }, []);

  useEffect(() => { setUnauthorizedHandler(clearSession); return () => setUnauthorizedHandler(undefined); }, [clearSession]);
  const restore = useCallback(async () => {
    setStatus('restoring'); setRestoreError(null);
    if (!await getStoredSession()) { setStatus('anonymous'); return; }
    try {
      const me = await authApi.me(); setUser(me.user); setBusiness(me.business); setRole(me.role); setStatus('authenticated');
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') return;
      setRestoreError(error instanceof ApiError ? error.message : 'Unable to restore your session.'); setStatus('restore-error');
    }
  }, []);
  useEffect(() => { void restore(); }, [restore]);

  const value = useMemo<AuthValue>(() => ({
    status, restoreError, user, business, role, restore,
    isOnboarded: Boolean(business && Array.isArray(business.defaultServices) && business.defaultServices.length > 0 && business.workingHours),
    login: async (email, password) => applySession(await authApi.login({ email, password })),
    register: async input => applySession(await authApi.register(input)),
    googleSignIn: async () => { const idToken = await requestGoogleIdToken(); if (!idToken) return false; const response = await authApi.google(idToken); if (response.business) preferences.completeOnboarding(); else if (response.isNewUser && preferences.onboardingComplete) preferences.resetOnboarding(); await applySession(response); return true; },
    linkGoogle: async () => { const idToken = await requestGoogleIdToken({ fresh: true }); if (!idToken) return false; await authApi.linkGoogle(idToken); setUser(current => current ? { ...current, authProviders: [...new Set([...(current.authProviders ?? []), 'GOOGLE' as const])] } : current); return true; },
    logout: async () => { const session = await getStoredSession(); if (session) await authApi.logout(session.refreshToken); await clearSession(); },
    logoutAll: async () => { await authApi.logoutAll(); await clearSession(); },
    forgotPassword: async email => (await authApi.forgotPassword(email)).message,
    resetPassword: async (token, password) => { const result = await authApi.resetPassword(token, password); await clearSession(); return result.message; },
    deleteAccount: async password => { await authApi.deleteAccount(password); await clearSession(); },
    deleteAccountWithGoogle: async () => { const idToken = await requestGoogleIdToken({ fresh: true }); if (!idToken) return false; await authApi.deleteAccountWithGoogle(idToken); await clearSession(); return true; },
    refreshBusiness: async () => { const next = await businessApi.get(); setBusiness(next); return next; },
  }), [applySession, business, clearSession, preferences, restore, restoreError, role, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used within AuthProvider'); return value; }
