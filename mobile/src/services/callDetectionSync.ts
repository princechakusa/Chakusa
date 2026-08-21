import { clearEvents, getPendingEvents } from 'chakusa-call-detection';
import { partitionMissedCallEvents } from '../domain/callDetection';
import { ApiError } from './api';
import { missedCallsApi } from './endpoints';

let syncPromise: Promise<void> | null = null;

async function syncOnce(): Promise<void> {
  const events = await getPendingEvents();
  if (events.length === 0) return;

  const { valid, invalidIds } = partitionMissedCallEvents(events);
  const synced: string[] = [];

  for (const event of valid) {
    try {
      await missedCallsApi.report({ phone: event.phone, occurredAt: event.occurredAt, clientEventId: event.clientEventId });
      synced.push(event.clientEventId);
    } catch (error) {
      // The endpoint is idempotent on clientEventId (see leads.service.ts's
      // createLeadFromMissedCall) — leaving this event queued is always
      // safe, whether the failure was a dropped connection or a transient
      // server error; the next sync (next foreground, or the next detected
      // call triggering one) retries it. Signed-out is the one case worth
      // short-circuiting the rest of this batch for, since every remaining
      // call would fail the same way.
      if (error instanceof ApiError && error.kind === 'unauthorized') break;
    }
  }

  // Malformed events (should never occur — see MissedCallStore.kt) can
  // never be fixed by retrying, so they're cleared immediately rather than
  // left to accumulate in the queue forever.
  await clearEvents([...synced, ...invalidIds]);
}

/** Drains the native missed-call queue into real Leads. Safe to call as often as convenient — concurrent calls collapse into one in-flight sync, matching the same dedup pattern pushNotifications.ts uses for device registration. */
export function syncPendingMissedCalls(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = syncOnce()
    .catch(() => undefined)
    .finally(() => { syncPromise = null; });
  return syncPromise;
}
