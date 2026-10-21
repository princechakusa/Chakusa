import { config } from "../config.js";
import { listAIProviderIds, registerAIProvider, unregisterAIProvider } from "./aiGateway.js";
import { createFakeAIProvider, FAKE_AI_PROVIDER_ID } from "./fakeAIProvider.js";
import { openAIProviderFromConfig } from "./providers/openaiProvider.js";
import { anthropicProviderFromConfig } from "./providers/anthropicProvider.js";
import { geminiProviderFromConfig } from "./providers/geminiProvider.js";

export interface AIProviderKeyOverrides {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
}

/**
 * Registers the built-in AI provider adapters at boot.
 *
 * - The deterministic in-repo fake is registered outside production so
 *   seeds, tests and local development run without API keys.
 * - The OpenAI, Anthropic and Gemini adapters register in any environment,
 *   but only when their API key is configured (same "credentials gate the
 *   adapter" shape as the Twilio/Stripe adapters). Additional providers slot
 *   in the same way with no runtime change — routeAI() only ever sees the
 *   AIProvider interface.
 * - `overrides` comes from the admin-set platform provider secrets store
 *   (src/lib/platformProviderSecrets.ts) and takes precedence over the
 *   matching env var when present, so a key set/rotated from the admin
 *   console is used without touching Render's env vars.
 */
export function registerBuiltInAIProviders(overrides: AIProviderKeyOverrides = {}) {
  if (config.NODE_ENV !== "production" && !listAIProviderIds().includes(FAKE_AI_PROVIDER_ID)) {
    registerAIProvider(createFakeAIProvider());
  }
  const openai = openAIProviderFromConfig(overrides.OPENAI_API_KEY);
  if (openai && !listAIProviderIds().includes(openai.id)) registerAIProvider(openai);
  const anthropic = anthropicProviderFromConfig(overrides.ANTHROPIC_API_KEY);
  if (anthropic && !listAIProviderIds().includes(anthropic.id)) registerAIProvider(anthropic);
  const gemini = geminiProviderFromConfig(overrides.GEMINI_API_KEY);
  if (gemini && !listAIProviderIds().includes(gemini.id)) registerAIProvider(gemini);
}

/** The vendor adapters whose keys can be changed at runtime. */
export const REAL_AI_PROVIDER_IDS = ["openai", "anthropic", "gemini"] as const;

/**
 * Rebuilds the vendor adapters with the current keys, so an AI key saved or
 * cleared in the admin console takes effect immediately - no restart, no
 * redeploy, no Render env edit. Admin keys win over env vars; clearing one
 * falls back to the env var (or removes the provider if there is none).
 */
export function reloadBuiltInAIProviders(overrides: AIProviderKeyOverrides = {}) {
  for (const id of REAL_AI_PROVIDER_IDS) unregisterAIProvider(id);
  registerBuiltInAIProviders(overrides);
}
