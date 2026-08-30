export type AIProviderId = "openai" | "anthropic" | "gemini" | "deepseek" | "open-model";
export interface AIRequest { model?: string; task: "classification" | "conversation" | "scheduling" | "extraction"; input: unknown; tenantId: string; }
export interface AIResponse { provider: AIProviderId; model: string; output: unknown; usage?: { inputTokens?: number; outputTokens?: number }; }
