import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../lib/config.js';
import { captureUnexpectedError } from '../lib/sentry.js';
import { processDueAutomationRuns } from '../lib/automation/executor.js';
import { sweepLifecycleAutomations } from '../lib/automation/scheduler.js';
import { sendDueAppointmentPaymentReminders, sendDueAppointmentReminders, sendDueCustomerAppointmentMessages } from '../modules/appointments/appointmentReminders.js';
import { sendDueReviewRequests } from '../modules/reviews/reviewAutomation.js';
import { expireStaleLocationShares } from '../modules/locationShare/locationShare.service.js';
import { recordWorkerHeartbeat } from './workerHeartbeat.js';
import { generateDueWeeklyOwnerReports } from '../modules/weeklyReports/weeklyReports.service.js';
import { publishOutboxBatch, recoverExpiredOutboxClaims } from './outboxPublisher.js';
import { dispatchDeliveryBatch, recoverExpiredDeliveries } from '../lib/automation/domainEventBus.js';
import { initializeWorkflowSchedules, registerWorkflowTriggerSubscribers, scheduleTimeTriggers } from '../lib/automation/triggerEngine.js';
import { registerDefaultActions } from '../lib/automation/defaultActions.js';
import { unavailableWorkflowGateways } from '../lib/automation/workflowProviderGateways.js';
import { processWorkflowExecutions } from './workflowWorker.js';
import { getAutomationFoundationStatus } from '../modules/automation/automationFoundation.js';
import { sweepExpiredQuotes } from '../lib/quotes/quoteExpiry.js';
import { processMessageDispatches, recoverStuckMessageDispatches } from '../lib/messaging/messagingPlatform.js';
import { expireAttachments, processAttachmentScans, recoverAttachmentProcessing } from '../lib/messaging/attachmentPlatform.js';
import { monitorProviderHealth, processConversationSLAs, processProviderTemplateSynchronizations, refreshProviderCredentials } from '../lib/messaging/messagingOperations.js';

export interface ScheduledWorkResult {
  processed: number;
  recovered: number;
  outboxPublished: number;
  deliveriesAcknowledged: number;
  workflowsProcessed: number;
  remindersSent: number;
  customerMessagesSent: number;
  paymentRemindersSent: number;
  reviewRequestsSent: number;
  quotesExpired: number;
  /** #23: how many isolated steps threw this cycle. 0 == fully clean. */
  failedSteps: number;
  /** #23: true when the foundation status could not be read and the cycle was skipped fail-safe. */
  skipped: boolean;
}

const EMPTY_RESULT: ScheduledWorkResult = {
  processed: 0, recovered: 0, outboxPublished: 0, deliveriesAcknowledged: 0, workflowsProcessed: 0,
  remindersSent: 0, customerMessagesSent: 0, paymentRemindersSent: 0, reviewRequestsSent: 0, quotesExpired: 0,
  failedSteps: 0, skipped: false,
};

let inFlight: Promise<ScheduledWorkResult> | null = null;
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

/**
 * #23 — one bounded, idempotency-safe cycle for an external HTTPS scheduler.
 *
 * Every step runs in isolation: a throw in one sweep is captured (Sentry) and
 * counted, never aborting the rest of the cycle and never preventing the
 * heartbeat. "The worker process is alive and cycling" stays true even when a
 * single poison-pill row fails one step — otherwise that row would drive a
 * /health/worker 503 and a restart loop that never clears it. Persistent step
 * failures surface as a rising Sentry error rate and a non-zero `failedSteps`.
 */
export function runTriggeredScheduledWork(): Promise<ScheduledWorkResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const result: ScheduledWorkResult = { ...EMPTY_RESULT };

    const step = async <T>(name: string, fn: () => Promise<T>, onOk?: (value: T) => void): Promise<void> => {
      try {
        const value = await fn();
        onOk?.(value);
      } catch (error) {
        result.failedSteps += 1;
        captureUnexpectedError(error, { tags: { scope: 'scheduled-work', step: name } });
        console.error(`[scheduled-work] step "${name}" failed`, error);
      }
    };

    try {
      await ensureInitialized();
    } catch (error) {
      // Init is retried on the next tick; a heartbeat still records below so
      // one bad init doesn't look like a dead worker.
      result.failedSteps += 1;
      captureUnexpectedError(error, { tags: { scope: 'scheduled-work', step: 'initialize' } });
      console.error('[scheduled-work] initialization failed', error);
    }

    // Fail safe: if the kill-switch / maintenance state can't be read, do NOT
    // run automation work this cycle — but still heartbeat (the process is up).
    let foundation: Awaited<ReturnType<typeof getAutomationFoundationStatus>> | null = null;
    try {
      foundation = await getAutomationFoundationStatus();
    } catch (error) {
      result.failedSteps += 1;
      result.skipped = true;
      captureUnexpectedError(error, { tags: { scope: 'scheduled-work', step: 'foundation-status' } });
      console.error('[scheduled-work] could not read foundation status; skipping work this cycle', error);
    }

    if (!foundation || foundation.maintenance || !foundation.killSwitches.automation) {
      result.skipped = result.skipped || Boolean(foundation);
      await recordHeartbeatSafely();
      return result;
    }

    // #23 — recovery of every lease-based queue's stranded in-flight rows runs
    // first, so a previous crashed cycle's work is picked back up.
    await step('recover-claims', () => Promise.all([recoverExpiredOutboxClaims(), recoverExpiredDeliveries(), recoverStuckMessageDispatches(new Date()), recoverAttachmentProcessing()]));
    await step('lifecycle-automations', () => sweepLifecycleAutomations());
    await step('automation-runs', () => processDueAutomationRuns(undefined, 20), (value) => {
      result.processed = value.processed;
      result.recovered = value.recovered;
    });
    await step('outbox', () => publishOutboxBatch(100), (value) => { result.outboxPublished = value.published; });
    await step('deliveries', () => dispatchDeliveryBatch(100), (value) => { result.deliveriesAcknowledged = value.delivered; });
    await step('workflow-executions', () => processWorkflowExecutions(100), (value) => { result.workflowsProcessed = value; });
    // #23 — the durable generic-outbound dispatch queue (enqueueMessage). Was
    // previously only drained by the long-running automationWorker, so a
    // deployment on the HTTP-tick path never sent these.
    await step('message-dispatches', () => processMessageDispatches(undefined, 50));
    await step('conversation-slas', () => processConversationSLAs());
    await step('time-triggers', () => scheduleTimeTriggers(new Date(), 250));
    await step('appointment-reminders', () => sendDueAppointmentReminders(undefined, 50), (value) => { result.remindersSent = value; });
    await step('customer-appointment-messages', () => sendDueCustomerAppointmentMessages(undefined, 50), (value) => { result.customerMessagesSent = value; });
    await step('payment-reminders', () => sendDueAppointmentPaymentReminders(undefined, 50), (value) => { result.paymentRemindersSent = value; });
    await step('review-requests', () => sendDueReviewRequests(undefined, 50), (value) => { result.reviewRequestsSent = value; });
    await step('expire-quotes', () => sweepExpiredQuotes(new Date(), 250), (value) => { result.quotesExpired = value.expired; });
    await step('expire-location-shares', () => expireStaleLocationShares(new Date()));
    await step('attachment-scans', () => processAttachmentScans(50));
    await step('expire-attachments', () => expireAttachments());
    await step('provider-health', () => monitorProviderHealth());
    await step('provider-credentials', () => refreshProviderCredentials());
    await step('provider-template-sync', () => processProviderTemplateSynchronizations(50));
    await step('weekly-reports', () => generateDueWeeklyOwnerReports(new Date(), 50));

    await recordHeartbeatSafely();
    return result;

    async function recordHeartbeatSafely() {
      try {
        await recordWorkerHeartbeat(triggerStartedAt);
      } catch (error) {
        captureUnexpectedError(error, { tags: { scope: 'scheduled-work', step: 'heartbeat' } });
        console.error('[scheduled-work] heartbeat write failed', error);
      }
    }
  })();
  return inFlight.finally(() => { inFlight = null; });
}
