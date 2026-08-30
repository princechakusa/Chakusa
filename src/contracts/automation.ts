export type AutomationCapabilityStatus = "ENABLED" | "DISABLED" | "BETA" | "INTERNAL" | "PRODUCTION";
export type AutomationExecutionState = "PENDING" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface AutomationFoundationStatus { capabilities: Record<string, AutomationCapabilityStatus>; killSwitches: Record<string, boolean>; providerKillSwitches: Record<string, boolean>; maintenance: boolean; updatedAt: string | null; }
