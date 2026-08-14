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
import { RootStackParamList } from './src/types';
import { publicReviewTokenFromPath } from './src/domain/publicFeedback';
import { PublicFeedbackScreen } from './src/screens/PublicFeedbackScreen';

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['chakusa://'],
  config: { screens: { ResetPassword: 'reset-password' } },
};

export default function App() {
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
  const publicReviewToken = publicReviewTokenFromPath(pathname);
  if (/^\/r(?:\/|$)/.test(pathname)) return <SafeAreaProvider><StatusBar style="dark" /><PublicFeedbackScreen token={publicReviewToken} /></SafeAreaProvider>;
  return (
    <SafeAreaProvider>
      <PreferencesProvider><AuthProvider><PushNotificationManager /><NotificationTapHandler /><AppProvider><PlanExperienceProvider><NavigationContainer ref={navigationRef} linking={linking}><StatusBar style="dark" /><AppNavigator /></NavigationContainer></PlanExperienceProvider></AppProvider></AuthProvider></PreferencesProvider>
    </SafeAreaProvider>
  );
}
