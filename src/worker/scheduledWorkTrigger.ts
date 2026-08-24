import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../lib/config.js';
import { processDueAutomationRuns } from '../lib/automation/executor.js';
import { sweepLifecycleAutomations } from '../lib/automation/scheduler.js';
import { sendDueAppointmentReminders } from '../modules/appointments/appointmentReminders.js';
import { recordWorkerHeartbeat } from './workerHeartbeat.js';

let inFlight: Promise<{ processed: number; recovered: number; remindersSent: number }> | null = null;
const triggerStartedAt = new Date();

export function validWorkerTriggerAuthorization(authorization: string | undefined) {
  const secret = config.WORKER_TRIGGER_SECRET;
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length);
  const expectedDigest = createHash('sha256').update(secret).digest();
  const suppliedDigest = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}

/** One bounded, idempotency-safe cycle for an external HTTPS scheduler. */
export function runTriggeredScheduledWork() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await sweepLifecycleAutomations();
    const automation = await processDueAutomationRuns(undefined, 20);
    const remindersSent = await sendDueAppointmentReminders(undefined, 50);
    await recordWorkerHeartbeat(triggerStartedAt);
    return { ...automation, remindersSent };
  })();
  return inFlight.finally(() => { inFlight = null; });
}
