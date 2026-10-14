import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { clearAIProviders, registerAIProvider } from "../src/lib/ai/aiGateway.js";
import { ensureBootstrapAIModel } from "../src/lib/ai/bootstrapModel.js";
import { resetDatabase } from "./helpers.js";

const stubOpenAI = { id: "openai", invoke: async () => ({ text: "ok" }) } as never;

describe("env-only AI model bootstrap", () => {
  const originalModel = config.OPENAI_DEFAULT_MODEL;
  const originalGemini = config.GEMINI_DEFAULT_MODEL;
  beforeEach(async () => { await resetDatabase(); clearAIProviders(); });
  afterEach(async () => { config.OPENAI_DEFAULT_MODEL = originalModel; config.GEMINI_DEFAULT_MODEL = originalGemini; clearAIProviders(); await resetDatabase(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("does nothing without the openai adapter or a default model", async () => {
    config.OPENAI_DEFAULT_MODEL = "google/gemma-4-31b-it:free";
    expect(await ensureBootstrapAIModel()).toBeNull();
    registerAIProvider(stubOpenAI);
    config.OPENAI_DEFAULT_MODEL = undefined;
    expect(await ensureBootstrapAIModel()).toBeNull();
    expect(await prisma.aIModelRegistry.count()).toBe(0);
  });

  it("registers the default model once, as an active conversation model", async () => {
    registerAIProvider(stubOpenAI);
    config.OPENAI_DEFAULT_MODEL = "google/gemma-4-31b-it:free";
    expect(await ensureBootstrapAIModel()).toEqual({ provider: "openai", model: "google/gemma-4-31b-it:free" });
    expect(await ensureBootstrapAIModel()).toBeNull();
    const rows = await prisma.aIModelRegistry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "openai", model: "google/gemma-4-31b-it:free", status: "ACTIVE" });
    expect(rows[0]!.capabilities).toContain("conversation");
  });

  it("prefers Gemini when both providers are configured", async () => {
    registerAIProvider(stubOpenAI);
    registerAIProvider({ id: "gemini", invoke: async () => ({ text: "ok" }) } as never);
    config.OPENAI_DEFAULT_MODEL = "google/gemma-4-31b-it:free";
    config.GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
    expect(await ensureBootstrapAIModel()).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
  });

  it("never overrides a model already managed from the admin console", async () => {
    await prisma.aIModelRegistry.create({ data: { provider: "anthropic", model: "admin-chosen", version: "1", capabilities: ["conversation"], approvedUseCases: [], status: "ACTIVE" } });
    registerAIProvider(stubOpenAI);
    config.OPENAI_DEFAULT_MODEL = "google/gemma-4-31b-it:free";
    expect(await ensureBootstrapAIModel()).toBeNull();
    expect(await prisma.aIModelRegistry.count()).toBe(1);
  });
});
