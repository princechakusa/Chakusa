import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CustomerAuthProvider } from './CustomerAuthContext';
import { CustomerNavigator } from './navigation/CustomerNavigator';
import { customerLinking } from './navigation/customerLinking';
import { navigationRef } from './navigation/customerNavigationRef';

// PROGRAM 2 LOOP 7: the root of the CUSTOMER experience. Mounted by the
// ExperienceRouter — never at the same time as BusinessRoot. Its own auth
// context, navigation container + ref and deep-link config; the business
// provider tree is never constructed here.
//
// PROGRAM 2 LOOP 10: `navReady` is flipped by the container's onReady and
// handed to the navigator so the pending-intent consumer can wait for the
// navigator without any timer.

export function CustomerRoot() {
  const [navReady, setNavReady] = useState(false);
  return (
    <SafeAreaProvider>
      <CustomerAuthProvider>
        <NavigationContainer ref={navigationRef} linking={customerLinking} onReady={() => setNavReady(true)}>
          <StatusBar style="dark" />
          <CustomerNavigator navReady={navReady} />
        </NavigationContainer>
      </CustomerAuthProvider>
    </SafeAreaProvider>
  );
}
