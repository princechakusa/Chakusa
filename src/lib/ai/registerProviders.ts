import { config } from "../config.js";
import { listAIProviderIds, registerAIProvider } from "./aiGateway.js";
import { createFakeAIProvider, FAKE_AI_PROVIDER_ID } from "./fakeAIProvider.js";
import { openAIProviderFromConfig } from "./providers/openaiProvider.js";
import { anthropicProviderFromConfig } from "./providers/anthropicProvider.js";

/**
 * Registers the built-in AI provider adapters at boot.
 *
 * - The deterministic in-repo fake is registered outside production so
 *   seeds, tests and local development run without API keys.
 * - The OpenAI and Anthropic adapters register in any environment, but only
 *   when their API key is configured (same "credentials gate the adapter"
 *   shape as the Twilio/Stripe adapters). Additional providers slot in the
 *   same way with no runtime change — routeAI() only ever sees the
 *   AIProvider interface.
 */
export function registerBuiltInAIProviders() {
  if (config.NODE_ENV !== "production" && !listAIProviderIds().includes(FAKE_AI_PROVIDER_ID)) {
    registerAIProvider(createFakeAIProvider());
  }
  const openai = openAIProviderFromConfig();
  if (openai && !listAIProviderIds().includes(openai.id)) registerAIProvider(openai);
  const anthropic = anthropicProviderFromConfig();
  if (anthropic && !listAIProviderIds().includes(anthropic.id)) registerAIProvider(anthropic);
}
