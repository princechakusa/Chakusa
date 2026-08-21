import type { CallScreeningRoleStatus, PendingMissedCallEvent } from 'chakusa-call-detection';

/**
 * The native queue (MissedCallStore.kt) is a best-effort SharedPreferences
 * store, not a validated database — this is the one place the JS layer
 * checks that a queued event is actually usable before spending a network
 * call on it. An event that fails this check can never be fixed by
 * retrying, so the sync layer clears it immediately rather than leaving it
 * stuck in the queue forever.
 */
export function isValidMissedCallEvent(event: PendingMissedCallEvent): boolean {
  return Boolean(event.clientEventId?.trim()) && Boolean(event.phone?.trim()) && !Number.isNaN(new Date(event.occurredAt).getTime());
}

export function partitionMissedCallEvents(events: PendingMissedCallEvent[]): { valid: PendingMissedCallEvent[]; invalidIds: string[] } {
  const valid: PendingMissedCallEvent[] = [];
  const invalidIds: string[] = [];
  for (const event of events) {
    if (isValidMissedCallEvent(event)) valid.push(event);
    else invalidIds.push(event.clientEventId);
  }
  return { valid, invalidIds };
}

export type CallDetectionAvailability = 'ready' | 'needs_role' | 'needs_phone_permission' | 'needs_both' | 'unsupported';

/** Both the call-screening role and the phone-state permission are required for detection to actually work — this is the single place that combines them into one status. */
export function callDetectionAvailability(roleStatus: CallScreeningRoleStatus, hasPhoneStatePermission: boolean): CallDetectionAvailability {
  if (roleStatus === 'unsupported') return 'unsupported';
  const needsRole = roleStatus !== 'granted';
  const needsPermission = !hasPhoneStatePermission;
  if (needsRole && needsPermission) return 'needs_both';
  if (needsRole) return 'needs_role';
  if (needsPermission) return 'needs_phone_permission';
  return 'ready';
}
