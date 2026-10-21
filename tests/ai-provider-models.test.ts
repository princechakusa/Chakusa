import { beforeEach, describe, expect, it, vi } from "vitest";

const overrides: Record<string, string | undefined> = {};
vi.mock("../src/lib/platformProviderSecrets.js", () => ({ loadPlatformProviderSecretOverrides: async () => overrides }));

const { listProviderModels } = await import("../src/lib/ai/providerModels.js");

type Call = { url: string; headers: Record<string, string> };
function stubFetch(status: number, json: unknown) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return { calls, fetchImpl };
}

describe("listProviderModels (admin model dropdown)", () => {
  beforeEach(() => { for (const key of Object.keys(overrides)) delete overrides[key]; });

  it("reports an unconfigured provider without calling it", async () => {
    const { calls, fetchImpl } = stubFetch(200, {});
    const result = await listProviderModels("anthropic", fetchImpl);
    expect(result).toEqual({ provider: "anthropic", configured: false, models: [] });
    expect(calls).toHaveLength(0);
  });

  it("lists only OpenAI chat models, sorted, using the saved key", async () => {
    overrides.OPENAI_API_KEY = "sk-saved";
    const { calls, fetchImpl } = stubFetch(200, { data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "dall-e-3" }, { id: "gpt-4o-mini-tts" }, { id: "o4-mini" }, { id: "gpt-4.1-nano" }] });
    const result = await listProviderModels("openai", fetchImpl);
    expect(result.models).toEqual(["gpt-4.1-nano", "gpt-4o-mini", "o4-mini"]);
    expect(calls[0].url).toBe("https://api.openai.com/v1/models");
    expect(calls[0].headers.authorization).toBe("Bearer sk-saved");
  });

  it("lists Gemini models that can generate content, without the models/ prefix", async () => {
    overrides.GEMINI_API_KEY = "g-key";
    const { calls, fetchImpl } = stubFetch(200, { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }] });
    const result = await listProviderModels("gemini", fetchImpl);
    expect(result.models).toEqual(["gemini-2.5-flash"]);
    expect(calls[0].headers["x-goog-api-key"]).toBe("g-key");
  });

  it("lists Anthropic models with the versioned header", async () => {
    overrides.ANTHROPIC_API_KEY = "a-key";
    const { calls, fetchImpl } = stubFetch(200, { data: [{ id: "claude-haiku-4-5" }] });
    const result = await listProviderModels("anthropic", fetchImpl);
    expect(result.models).toEqual(["claude-haiku-4-5"]);
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("explains a rejected key and never echoes it", async () => {
    overrides.OPENAI_API_KEY = "sk-bad";
    const { fetchImpl } = stubFetch(401, { error: { message: "Incorrect API key provided: sk-bad" } });
    const result = await listProviderModels("openai", fetchImpl);
    expect(result).toMatchObject({ configured: true, models: [], error: "The provider rejected this API key." });
    expect(JSON.stringify(result)).not.toContain("sk-bad");
  });

  it("survives a network failure", async () => {
    overrides.OPENAI_API_KEY = "sk-x";
    const result = await listProviderModels("openai", async () => { throw new Error("ECONNRESET"); });
    expect(result.error).toBe("Could not reach the provider.");
  });
});
