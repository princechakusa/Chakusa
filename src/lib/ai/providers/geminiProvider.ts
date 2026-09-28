import { config } from "../../config.js";
import type { AIProvider, AITask } from "../aiGateway.js";
import { AIProviderError, createFetchTransport, type ProviderTransport } from "./providerTransport.js";

// Google Gemini adapter. Implements the AIProvider contract only - the
// runtime never imports this file. Generative Language API v1beta
// generateContent; tools map to functionDeclarations, functionCall parts
// map back to `toolRequests`.

const DEFAULT_MODEL = "gemini-2.0-flash";

interface GeminiOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  transport?: ProviderTransport;
}

function toGeminiTools(tools: Array<{ name: string; schema: object }>) {
  if (!tools.length) return undefined;
  return [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, parameters: tool.schema ?? { type: "object", properties: {} } })) }];
}

function wantsJson(task: AITask): boolean {
  return task === "extraction" || task === "classification";
}

export function createGeminiProvider(options: GeminiOptions): AIProvider {
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const model = options.defaultModel ?? DEFAULT_MODEL;
  const transport = options.transport ?? createFetchTransport();

  return {
    id: "gemini",
    async invoke(input) {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-goog-api-key": options.apiKey,
      };

      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        systemInstruction: { parts: [{ text: `You are Chakusa's assistant. Context:\n${JSON.stringify(input.context ?? {})}` }] },
        ...(toGeminiTools(input.tools) ? { tools: toGeminiTools(input.tools) } : {}),
        ...(wantsJson(input.task) ? { generationConfig: { responseMimeType: "application/json" } } : {}),
      };

      const response = await transport.send({ url: `${baseUrl}/models/${input.model || model}:generateContent`, headers, body });
      const payload = response.json as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const parts = payload.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) throw new AIProviderError("Gemini returned no candidates", { kind: "server", retriable: true });

      const toolRequests = parts
        .filter((part) => part.functionCall)
        .map((part) => ({ name: part.functionCall?.name ?? "unknown", arguments: part.functionCall?.args ?? {} }));

      let output: unknown = parts.filter((part) => typeof part.text === "string").map((part) => part.text).join("");
      if (wantsJson(input.task) && typeof output === "string" && output) {
        try {
          output = JSON.parse(output);
        } catch {
          /* keep the raw string */
        }
      }

      return {
        output,
        usage: { inputTokens: payload.usageMetadata?.promptTokenCount, outputTokens: payload.usageMetadata?.candidatesTokenCount },
        toolRequests,
      };
    },
  };
}

/**
 * Registered by registerBuiltInAIProviders() when a Gemini API key is
 * available - either GEMINI_API_KEY or an admin-set platform provider
 * secret of the same name (see src/lib/platformProviderSecrets.ts), which
 * takes precedence so a key set/rotated from the admin console is used.
 */
export function geminiProviderFromConfig(apiKeyOverride?: string): AIProvider | null {
  const apiKey = apiKeyOverride ?? config.GEMINI_API_KEY;
  if (!apiKey) return null;
  return createGeminiProvider({
    apiKey,
    baseUrl: config.GEMINI_BASE_URL,
    defaultModel: config.GEMINI_DEFAULT_MODEL,
  });
}
