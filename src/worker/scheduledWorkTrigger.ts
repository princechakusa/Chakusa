import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../lib/config.js';
import { processDueAutomationRuns } from '../lib/automation/executor.js';
import { sweepLifecycleAutomations } from '../lib/automation/scheduler.js';
import { sendDueAppointmentPaymentReminders, sendDueAppointmentReminders, sendDueCustomerAppointmentMessages } from '../modules/appointments/appointmentReminders.js';
import { recordWorkerHeartbeat } from './workerHeartbeat.js';
import { generateDueWeeklyOwnerReports } from '../modules/weeklyReports/weeklyReports.service.js';
import { publishOutboxBatch, recoverExpiredOutboxClaims } from './outboxPublisher.js';
import { dispatchDeliveryBatch, recoverExpiredDeliveries } from '../lib/automation/domainEventBus.js';
import { initializeWorkflowSchedules, registerWorkflowTriggerSubscribers, scheduleTimeTriggers } from '../lib/automation/triggerEngine.js';
import { registerDefaultActions } from '../lib/automation/defaultActions.js';
import { unavailableWorkflowGateways } from '../lib/automation/workflowProviderGateways.js';
import { processWorkflowExecutions } from './workflowWorker.js';
import { getAutomationFoundationStatus } from '../modules/automation/automationFoundation.js';

let inFlight: Promise<{ processed: number; recovered: number; outboxPublished: number; deliveriesAcknowledged: number; workflowsProcessed: number; remindersSent: number; customerMessagesSent: number; paymentRemindersSent: number }> | null = null;
const triggerStartedAt = new Date();
let initialization: Promise<void> | null = null;
function ensureInitialized() { initialization ??= (async () => { registerDefaultActions(unavailableWorkflowGateways()); await registerWorkflowTriggerSubscribers(); await initializeWorkflowSchedules(); })(); return initialization; }

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
    await ensureInitialized();
    const foundation = await getAutomationFoundationStatus();
    if (foundation.maintenance || !foundation.killSwitches.automation) { await recordWorkerHeartbeat(triggerStartedAt); return { processed: 0, recovered: 0, outboxPublished: 0, deliveriesAcknowledged: 0, workflowsProcessed: 0, remindersSent: 0, customerMessagesSent: 0, paymentRemindersSent: 0 }; }
    await Promise.all([recoverExpiredOutboxClaims(), recoverExpiredDeliveries()]);
    await sweepLifecycleAutomations();
    const automation = await processDueAutomationRuns(undefined, 20);
    const outbox = await publishOutboxBatch(100);
    const deliveries = await dispatchDeliveryBatch(100);
    const workflowsProcessed = await processWorkflowExecutions(100);
    await scheduleTimeTriggers(new Date(), 250);
    const remindersSent = await sendDueAppointmentReminders(undefined, 50);
    const customerMessagesSent = await sendDueCustomerAppointmentMessages(undefined, 50);
    const paymentRemindersSent = await sendDueAppointmentPaymentReminders(undefined, 50);
    await generateDueWeeklyOwnerReports(new Date(), 50);
    await recordWorkerHeartbeat(triggerStartedAt);
    return { ...automation, outboxPublished: outbox.published, deliveriesAcknowledged: deliveries.delivered, workflowsProcessed, remindersSent, customerMessagesSent, paymentRemindersSent };
  })();
  return inFlight.finally(() => { inFlight = null; });
}
