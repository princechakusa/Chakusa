import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PublicFeedbackScreen } from './src/screens/PublicFeedbackScreen';
import { publicRouteFromPath } from './src/domain/publicRoutes';
import { PublicDocumentScreen } from './src/screens/PublicDocumentScreen';
import { PublicBusinessProfileScreen } from './src/screens/PublicBusinessProfileScreen';
import { PublicBookingManagementScreen } from './src/screens/PublicBookingManagementScreen';
import { ExperienceRouter } from './src/experience/ExperienceRouter';

export default function App() {
  // PROGRAM 2 LOOP 9: Chakusa is now ONE app with two experiences. The
  // ExperienceRouter picks, at runtime, exactly one shell to mount —
  // BusinessRoot (the original owner app, unchanged) or CustomerRoot. The
  // build-time EXPO_PUBLIC_APP_VARIANT is now only a dev override, honoured
  // inside the router.
  //
  // The web-only public routes below still short-circuit before any
  // provider or router mounts — behaviour unchanged.

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

  return <ExperienceRouter />;
}
