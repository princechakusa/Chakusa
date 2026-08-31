import { config } from "../../config.js";
import type { AIProvider, AITask } from "../aiGateway.js";
import { AIProviderError, createFetchTransport, type ProviderTransport } from "./providerTransport.js";

// LOOP 4: OpenAI adapter. Implements the AIProvider contract only — the
// runtime never imports this file. Chat Completions API; tools map to
// function tools, tool_calls map back to `toolRequests`; extraction /
// classification tasks request JSON object output.

const DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAIOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  organization?: string;
  transport?: ProviderTransport;
}

function toOpenAITools(tools: Array<{ name: string; schema: object }>) {
  if (!tools.length) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, parameters: tool.schema ?? { type: "object", properties: {} } },
  }));
}

function wantsJson(task: AITask): boolean {
  return task === "extraction" || task === "classification";
}

export function createOpenAIProvider(options: OpenAIOptions): AIProvider {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.defaultModel ?? DEFAULT_MODEL;
  const transport = options.transport ?? createFetchTransport();

  return {
    id: "openai",
    async invoke(input) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      };
      if (options.organization) headers["openai-organization"] = options.organization;

      const messages = [
        { role: "system", content: `You are Chakusa's assistant. Context:\n${JSON.stringify(input.context ?? {})}` },
        { role: "user", content: input.prompt },
      ];
      const body: Record<string, unknown> = {
        model: input.model || model,
        messages,
        stream: false,
        ...(toOpenAITools(input.tools) ? { tools: toOpenAITools(input.tools), tool_choice: "auto" } : {}),
        ...(wantsJson(input.task) ? { response_format: { type: "json_object" } } : {}),
      };

      const response = await transport.send({ url: `${baseUrl}/chat/completions`, headers, body });
      const payload = response.json as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = payload.choices?.[0]?.message;
      if (!choice) throw new AIProviderError("OpenAI returned no choices", { kind: "server", retriable: true });

      const toolRequests = (choice.tool_calls ?? []).map((call) => {
        let args: unknown = {};
        try {
          args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = { _raw: call.function?.arguments };
        }
        return { name: call.function?.name ?? "unknown", arguments: args };
      });

      let output: unknown = choice.content ?? "";
      if (wantsJson(input.task) && typeof output === "string" && output) {
        try {
          output = JSON.parse(output);
        } catch {
          /* keep the raw string */
        }
      }

      return {
        output,
        usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens },
        toolRequests,
      };
    },
  };
}

/** Registered by registerBuiltInAIProviders() when OPENAI_API_KEY is set. */
export function openAIProviderFromConfig(): AIProvider | null {
  if (!config.OPENAI_API_KEY) return null;
  return createOpenAIProvider({
    apiKey: config.OPENAI_API_KEY,
    baseUrl: config.OPENAI_BASE_URL,
    defaultModel: config.OPENAI_DEFAULT_MODEL,
  });
}
