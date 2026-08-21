import type { AutomationAvailability } from './automation';
import type { CallDetectionAvailability } from './callDetection';

export type EngineItemStatus = 'active' | 'attention' | 'locked' | 'unsupported';
export interface EngineItem {
  key: 'detection' | 'contactCoverage' | 'followUp' | 'notifications';
  label: string;
  /** Business-value framing — never mentions a permission, role, or API by name. */
  value: string;
  status: EngineItemStatus;
  /** Present only when the owner can act on it directly from this card. */
  action?: string;
}
export type RecoveryEngineOverall = 'active' | 'attention' | 'not_started';
export interface RecoveryEngineStatus { overall: RecoveryEngineOverall; items: EngineItem[]; }

export interface RecoveryEngineInput {
  /** 'unsupported' on iOS/web, or an Android device where the OS capability itself isn't available. */
  callDetection: CallDetectionAvailability;
  /**
   * Only meaningful once callDetection is 'ready' — Android's Telecom
   * framework skips ChakusaCallScreeningService entirely for calls from
   * numbers already saved in the device's contacts unless this permission
   * is held. Without it, detection still works, but only for calls from
   * numbers not yet saved as a contact.
   */
  hasContactsPermission: boolean;
  automationAvailability: AutomationAvailability;
  automationEnabled: boolean;
  pushGranted: boolean;
}

/**
 * Combines the three independent capabilities that together make up "the
 * Recovery Engine" from the owner's point of view — missed-call detection,
 * automatic follow-up, and notifications — into one status a business
 * owner can read at a glance. Each capability is graded on its own terms:
 * 'locked' (a real plan limitation, not something a tap fixes) is
 * deliberately excluded from the pass/fail calculation below, matching the
 * same principle setupScore.ts already uses for automation — a Free
 * business should never be told the engine "needs attention" over a
 * feature it isn't paying for.
 */
export function recoveryEngineStatus(input: RecoveryEngineInput): RecoveryEngineStatus {
  const items: EngineItem[] = [];

  if (input.callDetection !== 'unsupported') {
    const ready = input.callDetection === 'ready';
    items.push({
      key: 'detection',
      label: 'Missed-call detection',
      value: ready ? 'Chakusa is watching for missed calls on this phone.' : 'Turn this on so Chakusa can catch missed calls automatically.',
      status: ready ? 'active' : 'attention',
      action: ready ? undefined : 'Turn on',
    });

    // Showing this before base detection is ready would be confusing — a
    // business owner can't do anything useful with "also cover saved
    // contacts" advice until missed-call detection itself is on.
    if (ready) {
      items.push({
        key: 'contactCoverage',
        label: 'Coverage for saved customers',
        value: input.hasContactsPermission
          ? 'Chakusa catches missed calls from every number, including customers already saved in your contacts.'
          : 'Chakusa is only catching missed calls from numbers not yet saved as a contact. Turn this on to also catch calls from saved customers.',
        status: input.hasContactsPermission ? 'active' : 'attention',
        action: input.hasContactsPermission ? undefined : 'Turn on',
      });
    }
  }

  if (input.automationAvailability === 'available') {
    items.push({
      key: 'followUp',
      label: 'Automatic follow-up',
      value: input.automationEnabled ? 'Chakusa texts customers back automatically after a missed call.' : 'Turn on automatic follow-up so no missed call waits on you.',
      status: input.automationEnabled ? 'active' : 'attention',
      action: input.automationEnabled ? undefined : 'Turn on',
    });
  } else if (input.automationAvailability === 'free-locked') {
    items.push({ key: 'followUp', label: 'Automatic follow-up', value: 'Upgrade to Pro so Chakusa can text customers back automatically.', status: 'locked', action: 'View Pro' });
  } else if (input.automationAvailability === 'subscription-unavailable' || input.automationAvailability === 'service-unavailable') {
    items.push({ key: 'followUp', label: 'Automatic follow-up', value: 'Automatic follow-up isn’t available on your account right now.', status: 'locked' });
  }

  items.push({
    key: 'notifications',
    label: 'Notifications',
    value: input.pushGranted ? 'Chakusa can reach you the moment something needs you.' : 'Turn on notifications so you never miss an update.',
    status: input.pushGranted ? 'active' : 'attention',
    action: input.pushGranted ? undefined : 'Turn on',
  });

  const graded = items.filter(item => item.status === 'active' || item.status === 'attention');
  const overall: RecoveryEngineOverall = graded.some(item => item.status === 'attention')
    ? 'attention'
    : graded.length > 0
      ? 'active'
      : 'not_started';

  return { overall, items };
}
