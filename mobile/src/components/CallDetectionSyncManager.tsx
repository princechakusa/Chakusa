import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { addMissedCallListener } from 'chakusa-call-detection';
import { syncPendingMissedCalls } from '../services/callDetectionSync';
import { useAuth } from '../state/AuthContext';

/**
 * Android-only headless bootstrap — same pattern as PushNotificationManager:
 * drains the native missed-call queue (see MissedCallStore.kt) whenever the
 * app is authenticated and comes to the foreground, plus immediately on a
 * live detection event while the app is already running. This is the only
 * place a queued native detection actually becomes a real Lead — the
 * native layer never talks to the network itself.
 */
export function CallDetectionSyncManager() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (Platform.OS !== 'android' || status !== 'authenticated' || !user) return;

    void syncPendingMissedCalls();
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') void syncPendingMissedCalls();
    });
    const missedCallSubscription = addMissedCallListener(() => { void syncPendingMissedCalls(); });

    return () => {
      appStateSubscription.remove();
      missedCallSubscription.remove();
    };
  }, [status, user]);

  return null;
}
