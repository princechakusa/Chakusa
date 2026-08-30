export type MessagingChannel = "whatsapp" | "sms" | "email" | "push";
export interface MessagingRequest { businessId: string; channel: MessagingChannel; recipient: string; body: string; idempotencyKey: string; correlationId?: string; metadata?: Record<string, unknown>; }
export interface MessagingReceipt { accepted: boolean; channel: MessagingChannel; provider: string; providerMessageId?: string; status: "queued" | "sent" | "delivered" | "failed"; errorCode?: string; retryable?: boolean; }
