import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CustomerAuthUser, CustomerSelfProfileDto, CustomerSessionResponse, LegalDocumentType } from '../apiTypes';
import { PASSWORD_RESET_EMAIL_ENABLED } from '../config';
import { requestAppleCredential } from '../services/appleAuth';
import { requestGoogleIdToken } from '../services/googleAuth';
import { ApiError } from '../services/api';
import { PendingLegalDocument, withoutAccepted } from '../domain/legalAcceptance';
import { setCustomerUnauthorizedHandler } from './customerApi';
import { customerAuthApi, legalApi } from './endpoints';
import { clearPendingIntent } from '../experience/pendingIntentStorage';
import { clearCustomerSession, getCustomerSession, storeCustomerSession } from './session';
import { SESSION_RESTORE_TIMEOUT_COPY, SESSION_RESTORE_TIMEOUT_MS } from '../domain/startup';
import { clearSessionSnapshot, readSessionSnapshot, writeSessionSnapshot } from '../services/sessionSnapshot';

// PROGRAM 2 LOOP 7: customer authentication + secure session.
//
// This is a separate auth surface from the business `AuthContext`. It only
// ever touches the customer session store and the `/customer/auth/*`
// routes. A customer token is never sent to a business endpoint because
// this context is only mounted by `CustomerRoot`, which is only rendered
// when APP_VARIANT === 'customer'. Email + password sign-in / sign-up is
// always offered (the server validates it); only the reset email is gated,
// on PASSWORD_RESET_EMAIL_ENABLED, because it needs outbound mail.

export type CustomerAuthStatus =
  | 'restoring'        // reading a stored session on boot
  | 'restore-error'    // a stored session existed but could not be validated (offline etc.)
  | 'signed-out'       // no session - show the auth screen
  | 'authenticating'   // a sign-in / register call is in flight
  | 'authenticated';   // a valid customer session is held

export type CustomerAuthEvent = 'none' | 'session-expired' | 'signed-out' | 'account-deleted';

interface CustomerAuthValue {
  status: CustomerAuthStatus;
  restoreError: string | null;
  lastEvent: CustomerAuthEvent;
  passwordResetEnabled: boolean;
  user: CustomerAuthUser | null;
  profile: CustomerSelfProfileDto | null;
  pendingLegalDocuments: PendingLegalDocument[];
  legalAcceptanceRequired: boolean;
  restore: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (input: { email: string; password: string; fullName: string }) => Promise<void>;
  signInWithGoogle: () => Promise<boolean>;
  signInWithApple: () => Promise<boolean>;
  forgotPassword: (email: string) => Promise<string>;
  refreshLegalStatus: () => Promise<void>;
  acceptLegalDocument: (type: LegalDocumentType) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  /** Permanent deletion after a fresh identity check. Google/Apple resolve false if the person cancels. */
  deleteAccountWithPassword: (password: string) => Promise<void>;
  deleteAccountWithGoogle: () => Promise<boolean>;
  deleteAccountWithApple: () => Promise<boolean>;
  acknowledgeEvent: () => void;
}

const CustomerAuthContext = createContext<CustomerAuthValue | null>(null);

export function CustomerAuthProvider({ children }: PropsWithChildren) {
  const authAttempt = useRef(0);
  const restoreAbort = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<CustomerAuthStatus>('restoring');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<CustomerAuthEvent>('none');
  const [user, setUser] = useState<CustomerAuthUser | null>(null);
  const [profile, setProfile] = useState<CustomerSelfProfileDto | null>(null);
  const [pendingLegalDocuments, setPendingLegalDocuments] = useState<PendingLegalDocument[]>([]);

  const clearLocal = useCallback(async (event: CustomerAuthEvent) => {
    restoreAbort.current?.abort();
    const attempt = ++authAttempt.current;
    await clearCustomerSession();
    await clearSessionSnapshot('customer');
    if (attempt !== authAttempt.current) return;
    // PROGRAM 2 LOOP 10: drop any preserved customer destination on an
    // explicit sign-out / account close - but NOT on 'session-expired',
    // where the intent must survive so it opens after re-authentication.
    if (event === 'signed-out' || event === 'account-deleted') void clearPendingIntent();
    setUser(null);
    setProfile(null);
    setPendingLegalDocuments([]);
    setLastEvent(event);
    setStatus('signed-out');
  }, []);

  // The transport calls this when a refresh attempt is finally rejected - 
  // i.e. the session is genuinely gone, not just a transient failure.
  useEffect(() => {
    setCustomerUnauthorizedHandler(() => clearLocal('session-expired'));
    return () => setCustomerUnauthorizedHandler(undefined);
  }, [clearLocal]);

  const refreshLegalStatus = useCallback(async () => {
    const attempt = authAttempt.current;
    try { const documents = await legalApi.customerStatus(); if (attempt === authAttempt.current) setPendingLegalDocuments(documents.pending); }
    catch { /* best-effort: never block sign-in on the legal-status probe */ }
  }, []);

  const applySession = useCallback(async (response: CustomerSessionResponse, attempt: number) => {
    if (attempt !== authAttempt.current) return;
    await storeCustomerSession({ accessToken: response.accessToken, refreshToken: response.refreshToken });
    if (attempt !== authAttempt.current) return;
    setUser(response.user);
    setProfile(response.profile);
    void writeSessionSnapshot('customer', { user: response.user, profile: response.profile });
    setLastEvent('none');
    setStatus('authenticated');
    void refreshLegalStatus();
  }, [refreshLegalStatus]);

  const restore = useCallback(async () => {
    restoreAbort.current?.abort();
    const controller = new AbortController();
    restoreAbort.current = controller;
    const attempt = ++authAttempt.current;
    const timeout = setTimeout(() => {
      if (attempt !== authAttempt.current) return;
      authAttempt.current++;
      controller.abort();
      setRestoreError(SESSION_RESTORE_TIMEOUT_COPY);
      setStatus('restore-error');
    }, SESSION_RESTORE_TIMEOUT_MS);
    setStatus('restoring');
    setRestoreError(null);
    let optimistic = false;
    try {
      const existing = await getCustomerSession();
      if (attempt !== authAttempt.current) return;
      if (!existing) { setStatus('signed-out'); return; }
      // Open straight into the app from the last-known profile; the server
      // check below confirms (or ends) the session in the background.
      const snapshot = await readSessionSnapshot<{ user: CustomerSessionResponse['user']; profile: CustomerSessionResponse['profile'] }>('customer');
      if (attempt !== authAttempt.current) return;
      if (snapshot?.user && snapshot.profile) {
        optimistic = true;
        clearTimeout(timeout);
        setUser(snapshot.user);
        setProfile(snapshot.profile);
        setStatus('authenticated');
      }
      const me = await customerAuthApi.me(controller.signal);
      if (attempt !== authAttempt.current) return;
      setUser(me.user);
      setProfile(me.profile);
      void writeSessionSnapshot('customer', { user: me.user, profile: me.profile });
      setStatus('authenticated');
      void refreshLegalStatus();
    } catch (error) {
      if (attempt !== authAttempt.current) return;
      if (error instanceof ApiError && error.kind === 'unauthorized' && error.code !== 'AUTH_SESSION_CHANGED') { await clearLocal('session-expired'); return; }
      // Already showing the cached profile: a slow or offline server is not
      // an error the customer needs to see; requests retry on their own.
      if (optimistic) { void refreshLegalStatus(); return; }
      setRestoreError(error instanceof ApiError ? error.message : 'Unable to restore your session.');
      setStatus('restore-error');
    } finally {
      clearTimeout(timeout);
      if (restoreAbort.current === controller) restoreAbort.current = null;
    }
  }, [clearLocal, refreshLegalStatus]);

  useEffect(() => { void restore(); return () => { authAttempt.current++; restoreAbort.current?.abort(); }; }, [restore]);

  const runSignIn = useCallback(async (work: () => Promise<CustomerSessionResponse>, attempt = ++authAttempt.current) => {
    if (attempt !== authAttempt.current) return;
    setStatus('authenticating');
    try { await applySession(await work(), attempt); }
    catch (error) {
      if (attempt === authAttempt.current) setStatus(user ? 'authenticated' : 'signed-out');
      throw error;
    }
  }, [applySession, user]);

  const value = useMemo<CustomerAuthValue>(() => ({
    status,
    restoreError,
    lastEvent,
    passwordResetEnabled: PASSWORD_RESET_EMAIL_ENABLED,
    user,
    profile,
    pendingLegalDocuments,
    legalAcceptanceRequired: pendingLegalDocuments.length > 0,
    restore,
    loginWithEmail: (email, password) => runSignIn(() => customerAuthApi.login({ email, password })),
    registerWithEmail: (input) => runSignIn(() => customerAuthApi.register(input)),
    signInWithGoogle: async () => {
      const attempt = ++authAttempt.current;
      const idToken = await requestGoogleIdToken();
      if (!idToken || attempt !== authAttempt.current) return false;
      await runSignIn(() => customerAuthApi.google(idToken), attempt);
      return attempt === authAttempt.current;
    },
    signInWithApple: async () => {
      const attempt = ++authAttempt.current;
      const challenge = await customerAuthApi.appleChallenge();
      const credential = await requestAppleCredential({ ...challenge });
      if (!credential || attempt !== authAttempt.current) return false;
      await runSignIn(() => customerAuthApi.apple({ ...credential }), attempt);
      return attempt === authAttempt.current;
    },
    forgotPassword: async (email) => (await customerAuthApi.forgotPassword(email)).message,
    refreshLegalStatus,
    acceptLegalDocument: async (type) => {
      await legalApi.customerAccept(type, { source: 'app' });
      setPendingLegalDocuments((current) => withoutAccepted(current, type));
    },
    refreshProfile: async () => {
      const next = await customerAuthApi.me();
      setUser(next.user);
      setProfile(next.profile);
    },
    logout: async () => {
      const attempt = ++authAttempt.current;
      const session = await getCustomerSession();
      try { if (session) await customerAuthApi.logout(session.refreshToken); }
      catch { /* local sign-out must still succeed while offline */ }
      finally { if (attempt === authAttempt.current) await clearLocal('signed-out'); }
    },
    deleteAccountWithPassword: async (password) => {
      await customerAuthApi.deleteAccount({ password });
      await clearLocal('account-deleted');
    },
    deleteAccountWithGoogle: async () => {
      const idToken = await requestGoogleIdToken({ fresh: true });
      if (!idToken) return false;
      await customerAuthApi.deleteAccount({ googleIdToken: idToken });
      await clearLocal('account-deleted');
      return true;
    },
    deleteAccountWithApple: async () => {
      const challenge = await customerAuthApi.appleDeleteChallenge();
      const credential = await requestAppleCredential({ ...challenge });
      if (!credential) return false;
      await customerAuthApi.deleteAccount({ apple: { ...credential } });
      await clearLocal('account-deleted');
      return true;
    },
    acknowledgeEvent: () => setLastEvent('none'),
  }), [clearLocal, lastEvent, pendingLegalDocuments, profile, refreshLegalStatus, restore, restoreError, runSignIn, status, user]);

  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>;
}

export function useCustomerAuth() {
  const value = useContext(CustomerAuthContext);
  if (!value) throw new Error('useCustomerAuth must be used within CustomerAuthProvider');
  return value;
}
