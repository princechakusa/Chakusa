import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerCurrentDeviceForPush } from '../services/pushNotifications';
import { useAuth } from '../state/AuthContext';
import { usePreferences } from '../state/PreferencesContext';

export function PushNotificationManager() {
  const { status, user } = useAuth();
  const { onboardingComplete } = usePreferences();

  // Registration (which can trigger the OS permission prompt) is deferred
  // until onboarding is complete — the explicit onboarding notifications
  // step is the only place that prompt should first appear. See
  // OnboardingScreen's notifications step, which calls
  // registerCurrentDeviceForPush() directly for that first, explained ask.
  useEffect(() => {
    if (status !== 'authenticated' || !user || !onboardingComplete) return;

    void registerCurrentDeviceForPush();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void registerCurrentDeviceForPush();
    });
    return () => subscription.remove();
  }, [status, user, onboardingComplete]);

  return null;
}
