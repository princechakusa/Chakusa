import { useEffect, useMemo, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { BusinessRoot } from '../BusinessRoot';
import { APP_VARIANT } from '../config';
import { CustomerRoot } from '../customer/CustomerRoot';
import { getCustomerSession } from '../customer/session';
import { getStoredSession } from '../services/tokenStorage';
import { colors, spacing, typography } from '../theme';
import { ExperienceSelectScreen } from './ExperienceSelectScreen';
import { ExperienceContext, ExperienceValue } from './experienceContext';
import {
  classifyDeepLinkExperience,
  Experience,
  ExperienceOrUnselected,
  resolveInitialExperience,
} from './experience';
import { readExperiencePreference, writeExperiencePreference } from './experiencePreference';
import { normalizeDeepLinkIntent, normalizeNotificationIntent, PendingIntent } from './pendingIntent';
import { writePendingIntent } from './pendingIntentStorage';

export { useExperience } from './experienceContext';

// PROGRAM 2 LOOP 9: the runtime experience router. Exactly ONE experience
// shell is mounted at a time. This component holds no token and touches no
// session store beyond a boolean "is something there?" probe — the actual
// auth/session/transport isolation stays entirely inside BusinessRoot and
// CustomerRoot.

const FORCED: Experience | null = APP_VARIANT === 'customer' ? 'customer' : null;

export function ExperienceRouter() {
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [experience, setExperience] = useState<ExperienceOrUnselected>('unselected');
  const experienceRef = useRef<ExperienceOrUnselected>('unselected');
  experienceRef.current = experience;

  const apply = (next: ExperienceOrUnselected) => {
    experienceRef.current = next;
    setExperience(next);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [preference, businessSession, customerSession, initialUrl, lastNotification] = await Promise.all([
        readExperiencePreference(),
        getStoredSession().catch(() => null),
        getCustomerSession().catch(() => null),
        Linking.getInitialURL().catch(() => null),
        Platform.OS === 'web' ? Promise.resolve(null) : Notifications.getLastNotificationResponseAsync().catch(() => null),
      ]);
      if (cancelled) return;

      // PROGRAM 2 LOOP 10: a launch deep link / terminated-state
      // notification tap is normalised to a validated PendingIntent and
      // persisted here, BEFORE any shell mounts. The target shell's
      // navigator consumes it exactly once, only after that experience's
      // auth / legal / onboarding prerequisites are met. A deep link wins
      // over a notification when both are present.
      const launchIntent =
        normalizeDeepLinkIntent(initialUrl)
        ?? normalizeNotificationIntent(lastNotification?.notification.request.content.data as Record<string, unknown> | undefined);
      // A new launch intent replaces whatever was there. With no new
      // intent, any previously persisted one is left for its owning shell
      // to consume — the TTL in peek/consume is what expires it, so an
      // intent survives an OAuth / process bounce.
      if (launchIntent) await writePendingIntent(launchIntent);

      apply(resolveInitialExperience({
        preference,
        hasBusinessSession: Boolean(businessSession),
        hasCustomerSession: Boolean(customerSession),
        deepLinkExperience: launchIntent?.experience ?? classifyDeepLinkExperience(initialUrl),
        forced: FORCED,
      }));
      setPhase('ready');
    })();
    return () => { cancelled = true; };
  }, []);

  // Runtime deep links / notification taps for the OTHER experience:
  // normalise → persist the validated intent → switch. The target shell
  // then restores/authenticates and consumes the intent when ready. A link
  // for the CURRENT experience is left to that shell's own linking config /
  // tap handler (unchanged from Loop 9) to avoid double navigation.
  useEffect(() => {
    if (FORCED) return; // dev override: no cross-experience auto-switch
    const crossOver = (intent: PendingIntent | null) => {
      if (!intent || intent.experience === experienceRef.current) return;
      void writePendingIntent(intent);
      void writeExperiencePreference(intent.experience);
      apply(intent.experience);
    };
    const urlSub = Linking.addEventListener('url', ({ url }) => crossOver(normalizeDeepLinkIntent(url)));
    const noteSub = Platform.OS === 'web' ? null : Notifications.addNotificationResponseReceivedListener((response) => {
      crossOver(normalizeNotificationIntent(response.notification.request.content.data as Record<string, unknown> | undefined));
    });
    return () => { urlSub.remove(); noteSub?.remove(); };
  }, []);

  const value = useMemo<ExperienceValue>(() => ({
    experience,
    switchExperience: (target) => { void writeExperiencePreference(target); apply(target); },
    openSelector: () => apply('unselected'),
  }), [experience]);

  if (phase === 'loading') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Chakusa</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <ExperienceContext.Provider value={value}>
      {experience === 'business' ? <BusinessRoot />
        : experience === 'customer' ? <CustomerRoot />
        : (
          <SafeAreaProvider>
            <StatusBar style="dark" />
            <ExperienceSelectScreen onChoose={value.switchExperience} />
          </SafeAreaProvider>
        )}
    </ExperienceContext.Provider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.background },
  loadingText: { ...typography.caption, color: colors.textSecondary, letterSpacing: 2 },
});
