import { useEffect, useMemo, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
      const [preference, businessSession, customerSession, initialUrl] = await Promise.all([
        readExperiencePreference(),
        getStoredSession().catch(() => null),
        getCustomerSession().catch(() => null),
        Linking.getInitialURL().catch(() => null),
      ]);
      if (cancelled) return;
      apply(resolveInitialExperience({
        preference,
        hasBusinessSession: Boolean(businessSession),
        hasCustomerSession: Boolean(customerSession),
        deepLinkExperience: classifyDeepLinkExperience(initialUrl),
        forced: FORCED,
      }));
      setPhase('ready');
    })();
    return () => { cancelled = true; };
  }, []);

  // Runtime deep links: if a link for the OTHER experience arrives and that
  // experience already has a session, switch to it so its own linking
  // config can route the URL. Otherwise stay put — never switch on an
  // unclassifiable string, and never force a logged-out experience switch
  // from a background link.
  useEffect(() => {
    if (FORCED) return; // dev override: don't auto-switch
    const sub = Linking.addEventListener('url', ({ url }) => {
      const target = classifyDeepLinkExperience(url);
      if (!target || target === experienceRef.current) return;
      const probe = target === 'business' ? getStoredSession() : getCustomerSession();
      void probe.then((session) => {
        if (session) { void writeExperiencePreference(target); apply(target); }
      }).catch(() => undefined);
    });
    return () => sub.remove();
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
