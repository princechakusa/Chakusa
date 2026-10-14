import { config } from "../config.js";
import { prisma } from "../prisma.js";
import { listAIProviderIds } from "./aiGateway.js";

// Lets a deployment turn AI on with environment variables alone: when a
// provider adapter is registered (GEMINI_API_KEY, or OPENAI_API_KEY which can
// point at an OpenAI-compatible vendor such as OpenRouter via OPENAI_BASE_URL)
// and its *_DEFAULT_MODEL names a model, but the model registry has no ACTIVE
// model yet, register that one. Gemini is preferred when both are set. It
// never runs once any model is ACTIVE, so models managed from the admin
// console always win.

export const BOOTSTRAP_MODEL_CAPABILITIES = ["conversation"];
export const BOOTSTRAP_MODEL_USE_CASES = ["customer_agent", "customer_assistant", "ai_receptionist"];

export async function ensureBootstrapAIModel(): Promise<{ provider: string; model: string } | null> {
  const registered = listAIProviderIds();
  const candidate = ([["gemini", config.GEMINI_DEFAULT_MODEL], ["openai", config.OPENAI_DEFAULT_MODEL]] as const)
    .find(([provider, model]) => model && registered.includes(provider));
  if (!candidate) return null;
  const [provider, model] = candidate as readonly [string, string];
  const active = await prisma.aIModelRegistry.count({ where: { status: "ACTIVE" } });
  if (active > 0) return null;
  await prisma.aIModelRegistry.upsert({
    where: { provider_model_version: { provider, model, version: "1" } },
    create: { provider, model, version: "1", capabilities: BOOTSTRAP_MODEL_CAPABILITIES, approvedUseCases: BOOTSTRAP_MODEL_USE_CASES, status: "ACTIVE" },
    update: { status: "ACTIVE", capabilities: BOOTSTRAP_MODEL_CAPABILITIES, approvedUseCases: BOOTSTRAP_MODEL_USE_CASES },
  });
  return { provider, model };
}
