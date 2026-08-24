import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotificationTapHandler } from './src/components/NotificationTapHandler';
import { PushNotificationManager } from './src/components/PushNotificationManager';
import { CallDetectionSyncManager } from './src/components/CallDetectionSyncManager';
import { navigationRef } from './src/navigation/navigationRef';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AppProvider } from './src/state/AppContext';
import { AuthProvider } from './src/state/AuthContext';
import { PreferencesProvider } from './src/state/PreferencesContext';
import { PlanExperienceProvider } from './src/state/PlanExperienceContext';
import { BillingProvider } from './src/state/BillingContext';
import { RootStackParamList } from './src/types';
import { PublicFeedbackScreen } from './src/screens/PublicFeedbackScreen';
import { publicRouteFromPath } from './src/domain/publicRoutes';
import { PublicDocumentScreen } from './src/screens/PublicDocumentScreen';
import { PublicBusinessProfileScreen } from './src/screens/PublicBusinessProfileScreen';
import { PublicBookingManagementScreen } from './src/screens/PublicBookingManagementScreen';
import { MobileMonitoringIdentity } from './src/components/MobileMonitoringIdentity';

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['chakusa://'],
  config: { screens: { ResetPassword: 'reset-password', TeamInvite: 'team-invite/:token' } },
};

export default function App() {
  // React Native defines `window` (it aliases `global`) but has no
  // `window.location`, so guarding on `window` alone still dereferences
  // undefined and throws a fatal render-time TypeError before any UI
  // mounts. Both conditions are required: the first covers SSR/Node, the
  // second covers native. Web behavior is unchanged.
  const pathname = typeof window === 'undefined' || !window.location ? '' : window.location.pathname;
  const publicRoute = publicRouteFromPath(pathname);
  if (publicRoute?.kind === 'feedback') return <SafeAreaProvider><StatusBar style="dark" /><PublicFeedbackScreen token={publicRoute.token} /></SafeAreaProvider>;
  if (publicRoute?.kind === 'document') return <SafeAreaProvider><StatusBar style="dark" /><PublicDocumentScreen page={publicRoute.page} /></SafeAreaProvider>;
  if (publicRoute?.kind === 'business-profile') return <SafeAreaProvider><StatusBar style="dark" /><PublicBusinessProfileScreen slug={publicRoute.slug} /></SafeAreaProvider>;
  if (publicRoute?.kind === 'business-booking') return <SafeAreaProvider><StatusBar style="dark" /><PublicBookingManagementScreen slug={publicRoute.slug} token={publicRoute.token} /></SafeAreaProvider>;
  return (
    <SafeAreaProvider>
      <PreferencesProvider><AuthProvider><MobileMonitoringIdentity /><PushNotificationManager /><CallDetectionSyncManager /><NotificationTapHandler /><AppProvider><PlanExperienceProvider><BillingProvider><NavigationContainer ref={navigationRef} linking={linking}><StatusBar style="dark" /><AppNavigator /></NavigationContainer></BillingProvider></PlanExperienceProvider></AppProvider></AuthProvider></PreferencesProvider>
    </SafeAreaProvider>
  );
}
