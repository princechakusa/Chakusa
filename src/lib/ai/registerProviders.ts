import { config } from "../config.js";
import { listAIProviderIds, registerAIProvider } from "./aiGateway.js";
import { createFakeAIProvider, FAKE_AI_PROVIDER_ID } from "./fakeAIProvider.js";

/**
 * Registers the built-in AI provider adapters at boot. Today that is only
 * the deterministic in-repo fake, enabled outside production so seeds,
 * tests and local development run without API keys. Real provider adapters
 * (OpenAI, Anthropic, …) will register here too and are selected per
 * request via their AIModelRegistry rows.
 */
export function registerBuiltInAIProviders() {
  if (config.NODE_ENV !== "production" && !listAIProviderIds().includes(FAKE_AI_PROVIDER_ID)) {
    registerAIProvider(createFakeAIProvider());
  }
}
