import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';

import App from './App';
import { initMobileMonitoring } from './src/services/mobileMonitoring';
import { installWebAlert } from './src/utils/webAlert';

initMobileMonitoring();
// Web only: make Alert.alert confirmations work in the browser.
installWebAlert();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Sentry.wrap(App));
