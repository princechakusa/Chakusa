import { config } from "../config.js";
import { prisma } from "../prisma.js";
import { listAIProviderIds } from "./aiGateway.js";

// Lets a deployment turn AI on with environment variables alone: when the
// OpenAI-compatible adapter is registered (OPENAI_API_KEY, optionally pointed
// at another vendor such as OpenRouter via OPENAI_BASE_URL) and
// OPENAI_DEFAULT_MODEL names a model, but the model registry has no ACTIVE
// model yet, register that one. It never runs once any model is ACTIVE, so
// models managed from the admin console always win.

export const BOOTSTRAP_MODEL_CAPABILITIES = ["conversation"];
export const BOOTSTRAP_MODEL_USE_CASES = ["customer_agent", "customer_assistant", "ai_receptionist"];

export async function ensureBootstrapAIModel(): Promise<{ provider: string; model: string } | null> {
  const model = config.OPENAI_DEFAULT_MODEL;
  if (!model || !listAIProviderIds().includes("openai")) return null;
  const active = await prisma.aIModelRegistry.count({ where: { status: "ACTIVE" } });
  if (active > 0) return null;
  await prisma.aIModelRegistry.upsert({
    where: { provider_model_version: { provider: "openai", model, version: "1" } },
    create: { provider: "openai", model, version: "1", capabilities: BOOTSTRAP_MODEL_CAPABILITIES, approvedUseCases: BOOTSTRAP_MODEL_USE_CASES, status: "ACTIVE" },
    update: { status: "ACTIVE", capabilities: BOOTSTRAP_MODEL_CAPABILITIES, approvedUseCases: BOOTSTRAP_MODEL_USE_CASES },
  });
  return { provider: "openai", model };
}
