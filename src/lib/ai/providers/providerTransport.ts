import { config } from "../../config.js";

// LOOP 4: shared HTTP transport for the AI provider adapters. Uses global
// fetch (Node 20+) so adding a provider needs no new dependency; the adapter
// contract stays identical if a vendor SDK is swapped in later. Handles
// timeouts (AbortController), bounded exponential-backoff retry, and error
// normalization so the runtime never has to know a vendor's status codes.

export type ProviderErrorKind = "auth" | "rate_limit" | "timeout" | "bad_request" | "server" | "network" | "unknown";

export class AIProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retriable: boolean;
  readonly status?: number;
  readonly providerCode?: string;
  constructor(message: string, init: { kind: ProviderErrorKind; retriable: boolean; status?: number; providerCode?: string }) {
    super(message);
    this.name = "AIProviderError";
    this.kind = init.kind;
    this.retriable = init.retriable;
    this.status = init.status;
    this.providerCode = init.providerCode;
  }
}

export interface TransportRequest {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  /** Streaming SSE endpoints — the transport consumes the stream and returns the assembled JSON events. */
  stream?: boolean;
}

export interface TransportResponse {
  status: number;
  json: unknown;
  /** For stream:true — every parsed SSE `data:` payload, in order. */
  events?: unknown[];
}

export interface ProviderTransport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

function classify(status: number): { kind: ProviderErrorKind; retriable: boolean } {
  if (status === 401 || status === 403) return { kind: "auth", retriable: false };
  if (status === 429) return { kind: "rate_limit", retriable: true };
  if (status === 408 || status === 409) return { kind: "server", retriable: true };
  if (status >= 500) return { kind: "server", retriable: true };
  if (status >= 400) return { kind: "bad_request", retriable: false };
  return { kind: "unknown", retriable: false };
}

function providerCodeOf(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const code = (error as { code?: unknown; type?: unknown }).code ?? (error as { type?: unknown }).type;
      if (typeof code === "string") return code;
    }
  }
  return undefined;
}

async function parseSse(text: string): Promise<unknown[]> {
  const events: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // ignore keep-alive / non-JSON frames
    }
  }
  return events;
}

/** The real transport. Retries retriable failures with exponential backoff + jitter. */
export function createFetchTransport(options: { timeoutMs?: number; maxRetries?: number } = {}): ProviderTransport {
  const timeoutMs = options.timeoutMs ?? config.AI_PROVIDER_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? config.AI_PROVIDER_MAX_RETRIES;

  return {
    async send(request: TransportRequest): Promise<TransportResponse> {
      let lastError: AIProviderError | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(request.url, {
            method: request.method ?? "POST",
            headers: request.headers,
            body: request.body === undefined ? undefined : JSON.stringify(request.body),
            signal: controller.signal,
          });
          const rawText = await response.text();
          if (!response.ok) {
            let payload: unknown;
            try {
              payload = JSON.parse(rawText);
            } catch {
              payload = { error: { message: rawText.slice(0, 500) } };
            }
            const { kind, retriable } = classify(response.status);
            lastError = new AIProviderError(
              `Provider responded ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`,
              { kind, retriable, status: response.status, providerCode: providerCodeOf(payload) },
            );
            if (!retriable || attempt === maxRetries) throw lastError;
          } else if (request.stream) {
            return { status: response.status, json: null, events: await parseSse(rawText) };
          } else {
            return { status: response.status, json: rawText ? JSON.parse(rawText) : null };
          }
        } catch (error) {
          if (error instanceof AIProviderError) {
            lastError = error;
            if (!error.retriable || attempt === maxRetries) throw error;
          } else if ((error as Error)?.name === "AbortError") {
            lastError = new AIProviderError(`Provider request timed out after ${timeoutMs}ms`, { kind: "timeout", retriable: true });
            if (attempt === maxRetries) throw lastError;
          } else {
            lastError = new AIProviderError(`Provider request failed: ${(error as Error)?.message ?? "network error"}`, { kind: "network", retriable: true });
            if (attempt === maxRetries) throw lastError;
          }
        } finally {
          clearTimeout(timer);
        }
        // backoff before the next attempt
        const delay = Math.min(2_000, 150 * 2 ** attempt) + Math.floor(Math.random() * 100);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      throw lastError ?? new AIProviderError("Provider request failed", { kind: "unknown", retriable: false });
    },
  };
}
