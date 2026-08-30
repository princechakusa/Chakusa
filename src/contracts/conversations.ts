export type ConversationLifecycle = "OPEN" | "PAUSED" | "HUMAN_TAKEOVER" | "RESOLVED";
export type ConversationActor = "CUSTOMER" | "AUTOMATION" | "AI" | "HUMAN";
export interface ConversationEnvelope { conversationId: string; businessId: string; customerId: string; actor: ConversationActor; body: string; receivedAt: string; correlationId?: string; }
export interface ConversationControl { lifecycle: ConversationLifecycle; assignedMemberId?: string; automationResumeAt?: string; reason?: string; }
