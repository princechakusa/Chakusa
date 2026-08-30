import { processDueAutomationRuns } from "../lib/automation/executor.js";
import { sweepLifecycleAutomations } from "../lib/automation/scheduler.js";
import type { MessagingProvider } from "../lib/messaging/messagingProvider.js";
import { sendDueAppointmentPaymentReminders, sendDueAppointmentReminders, sendDueCustomerAppointmentMessages } from "../modules/appointments/appointmentReminders.js";
import type { PushProvider } from "../lib/push/pushProvider.js";
import { recordWorkerHeartbeat } from './workerHeartbeat.js';
import { generateDueWeeklyOwnerReports } from "../modules/weeklyReports/weeklyReports.service.js";
import { publishOutboxBatch, recoverExpiredOutboxClaims } from "./outboxPublisher.js";
import { dispatchDeliveryBatch, recoverExpiredDeliveries } from "../lib/automation/domainEventBus.js";
import { initializeWorkflowSchedules, registerWorkflowTriggerSubscribers, scheduleTimeTriggers } from "../lib/automation/triggerEngine.js";
import { registerDefaultActions, type IdempotentActionGateway } from "../lib/automation/defaultActions.js";
import { unavailableWorkflowGateways } from "../lib/automation/workflowProviderGateways.js";
import { processWorkflowExecutions } from "./workflowWorker.js";
import { getAutomationFoundationStatus } from "../modules/automation/automationFoundation.js";

export interface AutomationWorkerOptions {
  /** How often to poll for due runs. Default 15s. */
  intervalMs?: number;
  /**
   * How often to sweep for lifecycle-triggered runs (LEAD_FOLLOW_UP,
   * CUSTOMER_RETENTION) that need scheduling. Deliberately much slower than
   * intervalMs — these are time-elapsed conditions measured in hours/days,
   * not events needing near-real-time pickup like a newly-created lead.
   * Default 5 minutes.
   */
  lifecycleIntervalMs?: number;
  /** Max runs claimed per poll cycle. Default 20. */
  batchSize?: number;
  provider?: MessagingProvider;
  appointmentPushProvider?: PushProvider;
  appointmentMessagingProvider?: MessagingProvider;
  workflowGateways?: { messaging?: IdempotentActionGateway; ai?: IdempotentActionGateway };
  onError?: (error: unknown) => void;
}

export interface AutomationWorkerHandle {
  stop: () => Promise<void>;
}

/**
 * The smallest reliable execution mechanism this phase needs: a poll loop
 * over the AutomationRun table itself, which is already the durable queue
 * (see executor.ts) — no BullMQ/Redis/Kafka, no separate broker. Each tick
 * first recovers RUNNING runs whose execution lease has expired (a worker
 * that claimed a run and then crashed/was killed never got the chance to
 * move it to a terminal status — see executor.ts's LEASE_DURATION_SECONDS
 * and recoverStaleAutomationRuns) before claiming newly-due PENDING runs,
 * so a dead worker's in-flight work is picked back up automatically rather
 * than staying stuck RUNNING forever.
 *
 * Deliberately NOT started by src/app.ts/server.ts — see src/worker.ts for
 * the separate process entrypoint. HTTP startup staying free of background
 * loops is what keeps the manual Free/Pro product fully functional with no
 * worker running at all.
 */
export function startAutomationWorker(options: AutomationWorkerOptions = {}): AutomationWorkerHandle {
  const intervalMs = options.intervalMs ?? 15_000;
  const lifecycleIntervalMs = options.lifecycleIntervalMs ?? 300_000;
  const batchSize = options.batchSize ?? 20;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let lifecycleTimer: NodeJS.Timeout | undefined;
  let activeTick: Promise<void> | null = null;
  let activeLifecycleTick: Promise<void> | null = null;
  const startedAt = new Date();
  const initialized = (async () => { registerDefaultActions(options.workflowGateways ?? unavailableWorkflowGateways()); await registerWorkflowTriggerSubscribers(); await Promise.all([recoverExpiredOutboxClaims(), recoverExpiredDeliveries(), initializeWorkflowSchedules()]); })();

  const tick = async () => {
    if (stopped) return;
    await initialized;
    const foundation = await getAutomationFoundationStatus();
    if (!foundation.killSwitches.automation || foundation.maintenance) { try { await recordWorkerHeartbeat(startedAt); } catch (error) { options.onError?.(error); } if (!stopped) timer = setTimeout(() => { activeTick = tick().finally(() => { activeTick = null; }); }, intervalMs); return; }
    // These jobs share one worker process but are operationally independent.
    // One provider/database failure must not suppress reminders, payment
    // follow-ups, or the heartbeat for the rest of the cycle.
    const jobs: (() => Promise<unknown>)[] = [
      () => processDueAutomationRuns(options.provider, batchSize),
      () => publishOutboxBatch(batchSize),
      () => dispatchDeliveryBatch(batchSize),
      () => processWorkflowExecutions(batchSize),
      () => scheduleTimeTriggers(new Date(), Math.max(batchSize, 100)),
      () => sendDueAppointmentReminders(options.appointmentPushProvider, batchSize),
      () => sendDueCustomerAppointmentMessages(options.appointmentMessagingProvider ?? options.provider, batchSize),
      () => sendDueAppointmentPaymentReminders(options.appointmentMessagingProvider ?? options.provider, batchSize),
    ];
    for (const job of jobs) {
      try { await job(); } catch (error) { options.onError?.(error); }
    }
    try { await recordWorkerHeartbeat(startedAt); } catch (error) { options.onError?.(error); }
    if (!stopped) {
      timer = setTimeout(() => { activeTick = tick().finally(() => { activeTick = null; }); }, intervalMs);
    }
  };

  // Same worker process, same AutomationRun pipeline, just a second, much
  // slower entry point that schedules runs for the Customer Lifecycle
  // Automation Engine's two time-elapsed triggers — not a second worker.
  const lifecycleTick = async () => {
    if (stopped) return;
    try { await sweepLifecycleAutomations(); } catch (error) { options.onError?.(error); }
    try { await generateDueWeeklyOwnerReports(new Date(), 50, options.appointmentPushProvider); } catch (error) { options.onError?.(error); }
    if (!stopped) {
      lifecycleTimer = setTimeout(() => { activeLifecycleTick = lifecycleTick().finally(() => { activeLifecycleTick = null; }); }, lifecycleIntervalMs);
    }
  };

  timer = setTimeout(() => { activeTick = tick().finally(() => { activeTick = null; }); }, 0);
  lifecycleTimer = setTimeout(() => { activeLifecycleTick = lifecycleTick().finally(() => { activeLifecycleTick = null; }); }, 0);

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (lifecycleTimer) clearTimeout(lifecycleTimer);
      await Promise.allSettled([activeTick, activeLifecycleTick].filter((value): value is Promise<void> => value !== null));
    },
  };
}
