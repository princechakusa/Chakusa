import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotificationTapHandler } from './src/components/NotificationTapHandler';
import { PushNotificationManager } from './src/components/PushNotificationManager';
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

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['chakusa://'],
  config: { screens: { ResetPassword: 'reset-password' } },
};

export default function App() {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  const publicRoute = publicRouteFromPath(pathname);
  if (publicRoute?.kind === 'feedback') return <SafeAreaProvider><StatusBar style="dark" /><PublicFeedbackScreen token={publicRoute.token} /></SafeAreaProvider>;
  if (publicRoute?.kind === 'document') return <SafeAreaProvider><StatusBar style="dark" /><PublicDocumentScreen page={publicRoute.page} /></SafeAreaProvider>;
  return (
    <SafeAreaProvider>
      <PreferencesProvider><AuthProvider><PushNotificationManager /><NotificationTapHandler /><AppProvider><PlanExperienceProvider><BillingProvider><NavigationContainer ref={navigationRef} linking={linking}><StatusBar style="dark" /><AppNavigator /></NavigationContainer></BillingProvider></PlanExperienceProvider></AppProvider></AuthProvider></PreferencesProvider>
    </SafeAreaProvider>
  );
}
