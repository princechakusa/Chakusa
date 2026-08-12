import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { navigationRef } from '../navigation/navigationRef';
import { resolveNotificationTarget, NotificationTarget } from '../services/notificationRouting';
import { useAuth } from '../state/AuthContext';
import { usePreferences } from '../state/PreferencesContext';

/**
 * Routes a tapped push notification to its existing destination screen —
 * cold start (app launched by the tap), background (app resumed by the
 * tap), and foreground (tapped from the in-app banner) all funnel through
 * the same `addNotificationResponseReceivedListener` event, so one handler
 * covers all three without duplicating logic or notifications.
 *
 * A tap can arrive before the authenticated navigator tree exists (cold
 * start while logged out, or while the session is still restoring), so the
 * resolved target is held in `pendingTarget` (in-memory only, never
 * persisted) until `readyRef` — mirroring auth status + onboarding
 * completion, the same condition AppNavigator uses to mount LeadDetail /
 * ReviewDetail / CustomerProfile — and the navigation container both go
 * ready. This never bypasses authentication: it only navigates to a
 * screen, and that screen still fetches through the normal authenticated
 * API, which enforces tenant isolation server-side regardless of what the
 * notification payload claimed.
 */
export function NotificationTapHandler() {
  const { status } = useAuth();
  const { onboardingComplete } = usePreferences();
  const readyRef = useRef(false);
  const pendingTarget = useRef<NotificationTarget | null>(null);
  const processedIds = useRef(new Set<string>());

  const flushPending = () => {
    if (!readyRef.current || !pendingTarget.current || !navigationRef.isReady()) return;
    const target = pendingTarget.current;
    pendingTarget.current = null;
    navigationRef.navigate(target.screen, target.params as never);
  };

  useEffect(() => {
    readyRef.current = status === 'authenticated' && onboardingComplete;
    flushPending();
  }, [status, onboardingComplete]);

  useEffect(() => {
    // expo-notifications' response emitter is a no-op stub on web (it only
    // logs a warning), and push itself is never registered there — skip
    // subscribing entirely rather than let it warn on every launch.
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

    // Guards against the same tap being handled twice — Notifications.
    // getLastNotificationResponseAsync() keeps returning the launching
    // response for the lifetime of the app, so a remount (or calling it
    // once here while the live listener also fires for the same tap) would
    // otherwise navigate twice.
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (processedIds.current.has(id)) return;
      processedIds.current.add(id);

      void resolveNotificationTarget(response.notification.request.content.data).then(target => {
        if (!target) return;
        pendingTarget.current = target;
        flushPending();
      });
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    Notifications.getLastNotificationResponseAsync()
      .then(response => { if (response) handleResponse(response); })
      .catch(() => undefined);

    return () => subscription.remove();
  }, []);

  return null;
}
