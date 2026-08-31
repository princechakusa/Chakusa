import { config } from "../../config.js";
import type { AIProvider, AITask } from "../aiGateway.js";
import { AIProviderError, createFetchTransport, type ProviderTransport } from "./providerTransport.js";

// LOOP 4: Anthropic Claude adapter. Implements the AIProvider contract only.
// Messages API; tools map to Claude tool definitions, `tool_use` blocks map
// back to `toolRequests`. Structured output is requested via a system
// instruction (kept provider-neutral at the runtime boundary).

const DEFAULT_MODEL = "claude-sonnet-5";
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 1024;

interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  transport?: ProviderTransport;
}

function toAnthropicTools(tools: Array<{ name: string; schema: object }>) {
  if (!tools.length) return undefined;
  return tools.map((tool) => ({ name: tool.name, input_schema: tool.schema ?? { type: "object", properties: {} } }));
}

function wantsJson(task: AITask): boolean {
  return task === "extraction" || task === "classification";
}

export function createAnthropicProvider(options: AnthropicOptions): AIProvider {
  const baseUrl = (options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const model = options.defaultModel ?? DEFAULT_MODEL;
  const transport = options.transport ?? createFetchTransport();

  return {
    id: "anthropic",
    async invoke(input) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": options.apiKey,
        "anthropic-version": API_VERSION,
      };

      const systemParts = [`You are Chakusa's assistant. Context:\n${JSON.stringify(input.context ?? {})}`];
      if (wantsJson(input.task)) systemParts.push("Respond with a single valid JSON object and nothing else.");

      const body: Record<string, unknown> = {
        model: input.model || model,
        max_tokens: MAX_TOKENS,
        system: systemParts.join("\n\n"),
        messages: [{ role: "user", content: input.prompt }],
        ...(toAnthropicTools(input.tools) ? { tools: toAnthropicTools(input.tools) } : {}),
      };

      const response = await transport.send({ url: `${baseUrl}/messages`, headers, body });
      const payload = response.json as {
        content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (!Array.isArray(payload.content)) throw new AIProviderError("Anthropic returned no content", { kind: "server", retriable: true });

      const textParts = payload.content.filter((block) => block.type === "text").map((block) => block.text ?? "");
      const toolRequests = payload.content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({ name: block.name ?? "unknown", arguments: block.input ?? {} }));

      let output: unknown = textParts.join("").trim();
      if (wantsJson(input.task) && typeof output === "string" && output) {
        try {
          output = JSON.parse(output);
        } catch {
          /* keep the raw string */
        }
      }

      return {
        output,
        usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens },
        toolRequests,
      };
    },
  };
}

/** Registered by registerBuiltInAIProviders() when ANTHROPIC_API_KEY is set. */
export function anthropicProviderFromConfig(): AIProvider | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return createAnthropicProvider({
    apiKey: config.ANTHROPIC_API_KEY,
    baseUrl: config.ANTHROPIC_BASE_URL,
    defaultModel: config.ANTHROPIC_DEFAULT_MODEL,
  });
}
