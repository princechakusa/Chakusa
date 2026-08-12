import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerCurrentDeviceForPush } from '../services/pushNotifications';
import { useAuth } from '../state/AuthContext';

export function PushNotificationManager() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== 'authenticated' || !user) return;

    void registerCurrentDeviceForPush();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void registerCurrentDeviceForPush();
    });
    return () => subscription.remove();
  }, [status, user]);

  return null;
}
