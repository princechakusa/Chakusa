export type WorkflowNodeType = "condition" | "delay" | "action" | "branch";
export interface WorkflowNode { id: string; type: WorkflowNodeType; config: Record<string, unknown>; next?: string[]; }
export interface WorkflowDefinition { trigger: { type: string; config?: Record<string, unknown> }; nodes: WorkflowNode[]; startNodeId?: string; settings?: { timeoutSeconds?: number; maxRetries?: number }; }
export const SUPPORTED_TRIGGERS = ["CUSTOMER_CREATED","CUSTOMER_UPDATED","LEAD_CREATED","LEAD_UPDATED","APPOINTMENT_BOOKED","APPOINTMENT_UPDATED","APPOINTMENT_CANCELLED","APPOINTMENT_COMPLETED","PAYMENT_RECEIVED","PAYMENT_REFUNDED","REVIEW_SUBMITTED","MANUAL","SCHEDULED","BIRTHDAY","ANNIVERSARY"] as const;
