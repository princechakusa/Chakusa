import { processDueAutomationRuns } from "../lib/automation/executor.js";
import type { MessagingProvider } from "../lib/messaging/messagingProvider.js";

export interface AutomationWorkerOptions {
  /** How often to poll for due runs. Default 15s. */
  intervalMs?: number;
  /** Max runs claimed per poll cycle. Default 20. */
  batchSize?: number;
  provider?: MessagingProvider;
  onError?: (error: unknown) => void;
}

export interface AutomationWorkerHandle {
  stop: () => void;
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
  const batchSize = options.batchSize ?? 20;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await processDueAutomationRuns(options.provider, batchSize);
    } catch (error) {
      options.onError?.(error);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), intervalMs);
    }
  };

  timer = setTimeout(() => void tick(), 0);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
