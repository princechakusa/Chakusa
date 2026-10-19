import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Remote notifications require our own native build. Do not evaluate Expo's
// push-token module in Expo Go: Android reports a runtime error on import.
export const nativeNotifications: typeof import('expo-notifications') | null =
  Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient
    ? null
    : require('expo-notifications');
