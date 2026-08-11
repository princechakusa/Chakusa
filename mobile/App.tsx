import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppNavigator } from './src/navigation/AppNavigator';
import { AppProvider } from './src/state/AppContext';
import { AuthProvider } from './src/state/AuthContext';
import { PreferencesProvider } from './src/state/PreferencesContext';
import { RootStackParamList } from './src/types';

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['chakusa://'],
  config: { screens: { ResetPassword: 'reset-password' } },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <PreferencesProvider><AuthProvider><AppProvider><NavigationContainer linking={linking}><StatusBar style="dark" /><AppNavigator /></NavigationContainer></AppProvider></AuthProvider></PreferencesProvider>
    </SafeAreaProvider>
  );
}
