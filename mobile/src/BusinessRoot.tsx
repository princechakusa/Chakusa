import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotificationTapHandler } from './components/NotificationTapHandler';
import { PushNotificationManager } from './components/PushNotificationManager';
import { CallDetectionSyncManager } from './components/CallDetectionSyncManager';
import { MobileMonitoringIdentity } from './components/MobileMonitoringIdentity';
import { navigationRef } from './navigation/navigationRef';
import { AppNavigator } from './navigation/AppNavigator';
import { AppProvider } from './state/AppContext';
import { AuthProvider } from './state/AuthContext';
import { PreferencesProvider } from './state/PreferencesContext';
import { PlanExperienceProvider } from './state/PlanExperienceContext';
import { BillingProvider } from './state/BillingContext';
import { RootStackParamList } from './types';

// PROGRAM 2 LOOP 9: the existing business-owner application, extracted from
// App.tsx unchanged. This is a STRUCTURAL extraction only — the provider
// order, the NavigationContainer, the linking config, the business
// managers and AppNavigator are byte-for-byte what App.tsx rendered
// before. The ExperienceRouter mounts exactly one of BusinessRoot /
// CustomerRoot at a time, so the business provider tree (AuthProvider,
// BillingProvider, PlanExperienceProvider, push managers, …) never runs
// while the customer experience is active, and vice-versa.

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['chakusa://'],
  config: { screens: { ResetPassword: 'reset-password', TeamInvite: 'team-invite/:token' } },
};

export function BusinessRoot() {
  // PROGRAM 2 LOOP 10: `navReady` (flipped by the container's onReady) is
  // handed to AppNavigator so the pending-intent consumer can wait for the
  // navigator without a timer. Everything else is exactly the pre-Loop-9
  // App.tsx tree.
  const [navReady, setNavReady] = useState(false);
  return (
    <SafeAreaProvider>
      <PreferencesProvider><AuthProvider><MobileMonitoringIdentity /><PushNotificationManager /><CallDetectionSyncManager /><NotificationTapHandler /><AppProvider><PlanExperienceProvider><BillingProvider><NavigationContainer ref={navigationRef} linking={linking} onReady={() => setNavReady(true)}><StatusBar style="dark" /><AppNavigator navReady={navReady} /></NavigationContainer></BillingProvider></PlanExperienceProvider></AppProvider></AuthProvider></PreferencesProvider>
    </SafeAreaProvider>
  );
}
