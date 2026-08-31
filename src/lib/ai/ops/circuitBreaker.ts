import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";

// LOOP 3B-4: a lightweight in-process circuit breaker per (provider, model).
// It trips OPEN after a run of consecutive failures, half-opens after a
// cooldown, and closes again on the next success. Every state transition is
// persisted to AIProviderHealthCheck for the admin AI-health views.

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;
const ROLLING_WINDOW = 50;

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface BreakerState {
  circuit: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  samples: boolean[];
  latencies: number[];
  lastError?: string;
}

const breakers = new Map<string, BreakerState>();

function key(provider: string, model?: string | null): string {
  return `${provider}::${model ?? "*"}`;
}

function get(provider: string, model?: string | null): BreakerState {
  const id = key(provider, model);
  let state = breakers.get(id);
  if (!state) {
    state = { circuit: "CLOSED", consecutiveFailures: 0, openedAt: null, samples: [], latencies: [] };
    breakers.set(id, state);
  }
  return state;
}

export function resetCircuitBreakers() {
  breakers.clear();
}

function successRate(state: BreakerState): number {
  if (!state.samples.length) return 1;
  return state.samples.filter(Boolean).length / state.samples.length;
}

function p95(latencies: number[]): number | null {
  if (!latencies.length) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null;
}

function healthLabel(state: BreakerState): "HEALTHY" | "DEGRADED" | "DOWN" {
  if (state.circuit === "OPEN") return "DOWN";
  if (successRate(state) < 0.8 || state.consecutiveFailures >= 2) return "DEGRADED";
  return "HEALTHY";
}

async function persist(provider: string, model: string | null, state: BreakerState) {
  await prisma.aIProviderHealthCheck.create({
    data: {
      provider,
      model,
      status: healthLabel(state),
      circuitState: state.circuit,
      consecutiveFailures: state.consecutiveFailures,
      successRate: Number(successRate(state).toFixed(4)),
      p95LatencyMs: p95(state.latencies),
      sampleSize: state.samples.length,
      lastError: state.lastError ?? null,
      openedAt: state.openedAt ? new Date(state.openedAt) : null,
    },
  });
}

/** Throws (503) when the breaker is OPEN and still cooling down. */
export function guardProvider(provider: string, model?: string | null): { state: CircuitState } {
  const state = get(provider, model);
  if (state.circuit === "OPEN") {
    if (state.openedAt && Date.now() - state.openedAt >= COOLDOWN_MS) {
      state.circuit = "HALF_OPEN";
    } else {
      throw ApiError.serviceUnavailable(`AI provider "${provider}" is temporarily unavailable (circuit open)`);
    }
  }
  return { state: state.circuit };
}

/** Records the outcome of a provider call and advances the breaker. */
export async function recordProviderResult(input: { provider: string; model?: string | null; ok: boolean; latencyMs?: number; error?: string }) {
  const state = get(input.provider, input.model);
  const previous = state.circuit;
  state.samples.push(input.ok);
  if (state.samples.length > ROLLING_WINDOW) state.samples.shift();
  if (typeof input.latencyMs === "number") {
    state.latencies.push(input.latencyMs);
    if (state.latencies.length > ROLLING_WINDOW) state.latencies.shift();
  }

  if (input.ok) {
    state.consecutiveFailures = 0;
    state.lastError = undefined;
    if (state.circuit !== "CLOSED") {
      state.circuit = "CLOSED";
      state.openedAt = null;
    }
  } else {
    state.consecutiveFailures += 1;
    state.lastError = input.error;
    if (state.circuit === "HALF_OPEN" || state.consecutiveFailures >= FAILURE_THRESHOLD) {
      state.circuit = "OPEN";
      state.openedAt = Date.now();
    }
  }

  const transitioned = state.circuit !== previous;
  if (transitioned || !input.ok) {
    await persist(input.provider, input.model ?? null, state).catch(() => undefined);
  }
  return { circuit: state.circuit, transitioned, health: healthLabel(state) };
}

export function circuitBreakerSnapshot() {
  return [...breakers.entries()].map(([id, state]) => {
    const [provider, model] = id.split("::");
    return {
      provider,
      model: model === "*" ? null : model,
      circuit: state.circuit,
      consecutiveFailures: state.consecutiveFailures,
      successRate: Number(successRate(state).toFixed(4)),
      p95LatencyMs: p95(state.latencies),
      health: healthLabel(state),
      openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
    };
  });
}
