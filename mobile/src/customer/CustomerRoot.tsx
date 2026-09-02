import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CustomerAuthProvider } from './CustomerAuthContext';
import { CustomerNavigator } from './navigation/CustomerNavigator';
import { customerLinking } from './navigation/customerLinking';
import { navigationRef } from './navigation/customerNavigationRef';

// PROGRAM 2 LOOP 7: the root of the CUSTOMER application variant. Mounted
// by App.tsx only when APP_VARIANT === 'customer'. It shares nothing
// mutable with the business app — its own auth context, its own
// navigation container and ref, its own deep-link config. The business
// provider tree (AuthProvider, AppProvider, BillingProvider, …) is never
// constructed in a customer build.

export function CustomerRoot() {
  return (
    <SafeAreaProvider>
      <CustomerAuthProvider>
        <NavigationContainer ref={navigationRef} linking={customerLinking}>
          <StatusBar style="dark" />
          <CustomerNavigator />
        </NavigationContainer>
      </CustomerAuthProvider>
    </SafeAreaProvider>
  );
}
