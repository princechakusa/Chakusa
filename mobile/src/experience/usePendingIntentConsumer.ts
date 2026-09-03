import { useEffect, useRef } from 'react';

import { consumePendingIntent } from './pendingIntentStorage';
import type { Experience } from './experience';

// PROGRAM 2 LOOP 10: the consumer side of the pending-intent handoff.
// Mounted inside each experience's navigator. It fires at most ONCE, and
// only when `ready` is true. `ready` is supplied by the caller as
//   (that experience's auth / legal / onboarding prerequisites are met)
//   AND (the NavigationContainer signalled onReady)
// so a pending intent can never open a screen before those gates pass and
// never races the navigator. No timers, no polling — the effect simply
// re-runs when `ready` flips true.

interface NavHandle {
  isReady: () => boolean;
  navigate: (name: string, params?: object) => void;
  currentRouteName: () => string | undefined;
}

export function usePendingIntentConsumer(experience: Experience, ready: boolean, nav: NavHandle): void {
  const doneRef = useRef(false);

  useEffect(() => {
    if (!ready || doneRef.current || !nav.isReady()) return;
    doneRef.current = true; // exactly once per mount; consume clears storage too
    let cancelled = false;

    void consumePendingIntent(experience).then((intent) => {
      if (cancelled || !intent || !intent.route) return;
      // A cold-start deep link may already have been routed by the
      // container's own linking config — don't navigate on top of it.
      if (nav.currentRouteName() === intent.route) return;
      nav.navigate(intent.route, intent.params);
    });

    return () => { cancelled = true; };
  }, [ready, experience, nav]);
}
