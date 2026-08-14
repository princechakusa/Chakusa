import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SubscriptionStatusDto } from '../apiTypes';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { navigationRef } from '../navigation/navigationRef';
import { ApiError, setEntitlementErrorHandler } from '../services/api';
import { subscriptionApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { formatDate } from '../utils/format';
import { useAuth } from './AuthContext';

export type ServerPlan = 'FREE' | 'PRO';
type Details = { resource?: string; feature?: string; limit?: number; current?: number; plan?: string; requiredPlan?: string; periodResetsAt?: string };
type Notice = { title: string; body: string; reset?: string };

interface PlanExperienceValue {
  /** @deprecated use `plan` — kept so existing call sites (ProScreen, SettingsScreen) keep working unchanged. */
  serverPlan: ServerPlan | null;
  plan: ServerPlan | null;
  status: SubscriptionStatusDto['status'] | null;
  features: SubscriptionStatusDto['features'] | null;
  usage: SubscriptionStatusDto['usage'] | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  handleEntitlementError: (error: unknown) => boolean;
}
const Context = createContext<PlanExperienceValue | null>(null);

const resourceLabels: Record<string, { singular: string; plural: string; monthly: boolean }> = {
  leads: { singular: 'lead', plural: 'leads', monthly: true }, reviewRequests: { singular: 'review request', plural: 'review requests', monthly: true },
  customers: { singular: 'customer', plural: 'customers', monthly: false }, reminders: { singular: 'open reminder', plural: 'open reminders', monthly: false },
  templates: { singular: 'custom template for this type', plural: 'custom templates for this type', monthly: false },
};
const featureCopy: Record<string, { title: string; body: string }> = {
  AUTOMATION: { title: 'Automation is a Pro feature', body: 'With Pro, Chakusa can follow up automatically when you miss a customer. Mobile automation controls are not available yet.' },
  OUTBOUND_MESSAGING: { title: 'Chakusa messaging is a Pro feature', body: 'Pro enables Chakusa-initiated messaging. You can keep copying or opening messages manually on Free.' },
};

function noticeFor(error: ApiError): Notice {
  const details = (error.details && typeof error.details === 'object' ? error.details : {}) as Details;
  if (error.code === 'LIMIT_REACHED') {
    const resource = resourceLabels[details.resource ?? '']; const limit = details.limit; const noun = resource ? (limit === 1 ? resource.singular : resource.plural) : 'items';
    const body = typeof limit === 'number' ? `You've used all ${limit} ${noun}${resource?.monthly ? ' available this month' : ' available on the Free plan'}.` : `You've reached the usage available on the Free plan.`;
    return { title: `You've reached your Free plan limit`, body, reset: details.periodResetsAt ? `Your limit resets on ${formatDate(details.periodResetsAt, { month: 'long', day: 'numeric' })}.` : undefined };
  }
  const copy = featureCopy[details.feature ?? ''];
  return copy ?? { title: 'This is a Pro feature', body: 'This capability requires Chakusa Pro. Your current manual tools remain available.' };
}

export function PlanExperienceProvider({ children }: PropsWithChildren) {
  const [subscription, setSubscription] = useState<SubscriptionStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { status: authStatus } = useAuth();

  // Deduplicates concurrent refresh() calls (foreground-resume racing a
  // post-create refresh, say) into a single in-flight request rather than
  // firing the network call twice — later callers just await the request
  // already underway.
  const inFlightRef = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;
    const request = (async () => {
      setLoading(true);
      try {
        const next = await subscriptionApi.getStatus();
        setSubscription(next);
        setError(null);
      } catch (caught) {
        // Product-state loading is independent of the rest of the app —
        // a transient failure here must never log the user out, must
        // never be mistaken for PRO, and must never zero out usage that
        // was previously known. Keep the last-good subscription snapshot
        // and only surface a lightweight error for plan/usage UI to show.
        setError(caught instanceof ApiError ? caught.message : 'Unable to load your plan right now.');
      } finally {
        setLoading(false);
      }
    })();
    inFlightRef.current = request;
    try {
      await request;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  // Initial load: fires once the session is actually authenticated (not
  // during 'restoring' or 'anonymous') — this covers both a fresh sign-in
  // and a restored session, since both transition status to
  // 'authenticated' through the same AuthContext path.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      void refresh();
    } else if (authStatus === 'anonymous') {
      // A second user on this device must never see the previous
      // business's plan/usage — clear every field, not just the plan.
      setSubscription(null);
      setError(null);
      setNotice(null);
    }
  }, [authStatus, refresh]);

  // Foreground refresh — same AppState pattern as PushNotificationManager.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const subscriptionListener = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void refresh();
    });
    return () => subscriptionListener.remove();
  }, [authStatus, refresh]);

  const handleEntitlementError = useCallback((caught: unknown) => {
    if (!(caught instanceof ApiError) || !['LIMIT_REACHED', 'FEATURE_NOT_AVAILABLE', 'PLAN_REQUIRED'].includes(caught.code ?? '')) return false;
    // Show the dialog immediately using the server's error details — never
    // delay it waiting on the network. refresh() runs in the background so
    // the usage UI catches up once it resolves.
    setNotice(noticeFor(caught));
    void refresh();
    return true;
  }, [refresh]);
  useEffect(() => { setEntitlementErrorHandler(handleEntitlementError); return () => setEntitlementErrorHandler(undefined); }, [handleEntitlementError]);

  const value = useMemo<PlanExperienceValue>(() => ({
    serverPlan: subscription?.plan ?? null,
    plan: subscription?.plan ?? null,
    status: subscription?.status ?? null,
    features: subscription?.features ?? null,
    usage: subscription?.usage ?? null,
    loading,
    error,
    refresh,
    handleEntitlementError,
  }), [subscription, loading, error, refresh, handleEntitlementError]);

  return <Context.Provider value={value}>{children}<Modal visible={Boolean(notice)} transparent animationType="fade" onRequestClose={() => setNotice(null)}><View style={styles.overlay}><View accessibilityViewIsModal style={styles.dialog}><Text style={styles.title}>{notice?.title}</Text><Text style={styles.body}>{notice?.body}</Text>{notice?.reset ? <Text style={styles.reset}>{notice.reset}</Text> : null}<PrimaryButton fullWidth label="View Pro" onPress={() => { setNotice(null); if (navigationRef.isReady()) navigationRef.navigate('Pro'); }} /><SecondaryButton fullWidth label="Not now" onPress={() => setNotice(null)} /></View><Pressable accessibilityLabel="Dismiss upgrade information" style={StyleSheet.absoluteFill} onPress={() => setNotice(null)} /></View></Modal></Context.Provider>;
}
export function usePlanExperience() { const value = useContext(Context); if (!value) throw new Error('usePlanExperience must be used within PlanExperienceProvider'); return value; }
const styles = StyleSheet.create({ overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }, dialog: { zIndex: 1, width: '100%', maxWidth: 440, borderRadius: radius.xl, backgroundColor: colors.surface, padding: spacing.xl, gap: spacing.md }, title: { ...typography.heading, color: colors.text }, body: { ...typography.body, color: colors.textSecondary }, reset: { ...typography.bodyStrong, color: colors.text } });
