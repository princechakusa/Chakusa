import { createHash } from "node:crypto";
import type { AIProvider, AITask } from "./aiGateway.js";

export const FAKE_AI_PROVIDER_ID = "chakusa-fake";
export const FAKE_AI_MODEL = "chakusa-fake-1";

/**
 * Deterministic, fully offline stand-in for a real model provider. The same
 * (task, model, prompt) triple always produces the same output, usage and
 * confidence, so prompt seeds, the evaluation harness and local development
 * are reproducible without network access or API keys. Real providers
 * register under their own id (see registerAIProvider) and are selected via
 * AIModelRegistry rows; this one only answers for the `chakusa-fake` row.
 */
export function createFakeAIProvider(): AIProvider {
  return {
    id: FAKE_AI_PROVIDER_ID,
    async invoke({ model, task, prompt }: { model: string; task: AITask; prompt: string; context: unknown; tools: Array<{ name: string; schema: object }> }) {
      const digest = createHash("sha256").update(`${task}\n${model}\n${prompt}`).digest("hex");
      const seed = Number.parseInt(digest.slice(0, 8), 16);
      const inputTokens = Math.max(1, Math.ceil(prompt.length / 4));
      const outputTokens = 12 + (seed % 40);
      const output =
        task === "classification"
          ? { label: ["booking", "quote", "support", "review"][seed % 4], rationale: `deterministic:${digest.slice(0, 12)}` }
          : { text: `[${task}] ${digest.slice(0, 16)}`, digest };
      return {
        output,
        confidence: 0.7 + (seed % 25) / 100,
        usage: { inputTokens, outputTokens, reasoningTokens: 0 },
        toolRequests: [],
      };
    },
  };
}
