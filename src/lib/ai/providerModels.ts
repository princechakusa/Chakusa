import { config } from "../config.js";
import { loadPlatformProviderSecretOverrides } from "../platformProviderSecrets.js";

// Lists the models a provider key can actually use, so the admin console
// offers a dropdown instead of a free-text model id that can be mistyped or
// retired. The key never leaves the server; only model ids are returned.

export const LISTABLE_AI_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
export type ListableAIProvider = (typeof LISTABLE_AI_PROVIDERS)[number];

export type ProviderModelList = { provider: ListableAIProvider; configured: boolean; models: string[]; error?: string };

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// OpenAI's /models also returns embedding, audio, image and moderation models,
// which cannot answer a chat. A custom base URL (e.g. OpenRouter) serves only
// chat models, so nothing is filtered there.
const OPENAI_CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|image|audio|realtime|transcribe|moderation|search)/;

export async function listProviderModels(provider: ListableAIProvider, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<ProviderModelList> {
  const overrides = await loadPlatformProviderSecretOverrides();
  const key = { openai: overrides.OPENAI_API_KEY ?? config.OPENAI_API_KEY, anthropic: overrides.ANTHROPIC_API_KEY ?? config.ANTHROPIC_API_KEY, gemini: overrides.GEMINI_API_KEY ?? config.GEMINI_API_KEY }[provider];
  if (!key) return { provider, configured: false, models: [] };

  const requests: Record<ListableAIProvider, { url: string; headers: Record<string, string> }> = {
    openai: { url: `${(config.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/models`, headers: { authorization: `Bearer ${key}` } },
    anthropic: { url: `${(config.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1").replace(/\/$/, "")}/models?limit=1000`, headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } },
    gemini: { url: `${(config.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "")}/models?pageSize=1000`, headers: { "x-goog-api-key": key } },
  };
  const request = requests[provider];

  try {
    const response = await fetchImpl(request.url, { headers: request.headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { provider, configured: true, models: [], error: response.status === 401 || response.status === 403 ? "The provider rejected this API key." : `The provider answered HTTP ${response.status}.` };
    const body = (await response.json()) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    let models: string[];
    if (provider === "gemini") {
      models = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => (m.name ?? "").replace(/^models\//, ""));
    } else {
      models = (body.data ?? []).map((m) => m.id ?? "");
      if (provider === "openai" && !config.OPENAI_BASE_URL) models = models.filter((id) => OPENAI_CHAT_MODEL.test(id) && !OPENAI_NON_CHAT.test(id));
    }
    return { provider, configured: true, models: [...new Set(models.filter(Boolean))].sort() };
  } catch {
    return { provider, configured: true, models: [], error: "Could not reach the provider." };
  }
}
