import type { AutomationExecutionState } from "./automation.js";
export type RuntimeReadiness = "READY" | "DEGRADED" | "DISABLED";
export interface RuntimeContract { workflowId: string; version: number; businessId: string; idempotencyKey: string; triggerEventId?: string; }
export interface RuntimeResult { executionId: string; status: AutomationExecutionState; nextAttemptAt?: string; error?: string; }
