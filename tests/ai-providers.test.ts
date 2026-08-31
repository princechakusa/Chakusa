import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "../src/lib/ai/providers/openaiProvider.js";
import { createAnthropicProvider } from "../src/lib/ai/providers/anthropicProvider.js";
import { AIProviderError, createFetchTransport, type ProviderTransport, type TransportRequest } from "../src/lib/ai/providers/providerTransport.js";

function stubTransport(handler: (request: TransportRequest) => { status?: number; json: unknown }): ProviderTransport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      const result = handler(request);
      return { status: result.status ?? 200, json: result.json };
    },
  };
}

describe("AI provider adapters (LOOP 4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("OpenAI adapter", () => {
    it("authenticates, targets chat/completions, and returns text", async () => {
      const transport = stubTransport(() => ({ json: { choices: [{ message: { content: "Hello there" } }], usage: { prompt_tokens: 12, completion_tokens: 4 } } }));
      const provider = createOpenAIProvider({ apiKey: "sk-test", transport });
      const result = await provider.invoke({ model: "gpt-4o-mini", task: "conversation", prompt: "hi", context: {}, tools: [] });
      expect(result.output).toBe("Hello there");
      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
      expect(transport.calls[0]?.url).toMatch(/\/chat\/completions$/);
      expect(transport.calls[0]?.headers.authorization).toBe("Bearer sk-test");
    });

    it("maps tool_calls to toolRequests with parsed arguments", async () => {
      const transport = stubTransport(() => ({
        json: { choices: [{ message: { content: null, tool_calls: [{ function: { name: "book_appointment", arguments: '{"serviceOfferingId":"abc","startsAt":"2027-01-01T10:00:00Z"}' } }] } }] },
      }));
      const provider = createOpenAIProvider({ apiKey: "sk-test", transport });
      const result = await provider.invoke({ model: "gpt-4o-mini", task: "conversation", prompt: "book", context: {}, tools: [{ name: "book_appointment", schema: { type: "object" } }] });
      expect(result.toolRequests).toEqual([{ name: "book_appointment", arguments: { serviceOfferingId: "abc", startsAt: "2027-01-01T10:00:00Z" } }]);
      expect((transport.calls[0]?.body as { tools?: unknown[] }).tools).toHaveLength(1);
    });

    it("requests JSON output for extraction tasks and parses it", async () => {
      const transport = stubTransport(() => ({ json: { choices: [{ message: { content: '{"intent":"booking"}' } }] } }));
      const provider = createOpenAIProvider({ apiKey: "sk-test", transport });
      const result = await provider.invoke({ model: "gpt-4o-mini", task: "extraction", prompt: "classify", context: {}, tools: [] });
      expect(result.output).toEqual({ intent: "booking" });
      expect((transport.calls[0]?.body as { response_format?: unknown }).response_format).toEqual({ type: "json_object" });
    });
  });

  describe("Anthropic adapter", () => {
    it("uses x-api-key + version headers and targets /messages", async () => {
      const transport = stubTransport(() => ({ json: { content: [{ type: "text", text: "Bonjour" }], usage: { input_tokens: 9, output_tokens: 2 } } }));
      const provider = createAnthropicProvider({ apiKey: "ak-test", transport });
      const result = await provider.invoke({ model: "claude-sonnet-5", task: "conversation", prompt: "salut", context: { a: 1 }, tools: [] });
      expect(result.output).toBe("Bonjour");
      expect(transport.calls[0]?.url).toMatch(/\/messages$/);
      expect(transport.calls[0]?.headers["x-api-key"]).toBe("ak-test");
      expect(transport.calls[0]?.headers["anthropic-version"]).toBeTruthy();
    });

    it("maps tool_use blocks to toolRequests", async () => {
      const transport = stubTransport(() => ({
        json: { content: [{ type: "text", text: "one moment" }, { type: "tool_use", name: "check_availability", input: { serviceOfferingId: "s1" } }] },
      }));
      const provider = createAnthropicProvider({ apiKey: "ak-test", transport });
      const result = await provider.invoke({ model: "claude-sonnet-5", task: "conversation", prompt: "when can I come in", context: {}, tools: [{ name: "check_availability", schema: { type: "object" } }] });
      expect(result.toolRequests).toEqual([{ name: "check_availability", arguments: { serviceOfferingId: "s1" } }]);
    });
  });

  describe("fetch transport: retry, timeout, error normalization", () => {
    it("retries a 429 then succeeds", async () => {
      let call = 0;
      vi.stubGlobal("fetch", vi.fn(async () => {
        call += 1;
        if (call === 1) return new Response(JSON.stringify({ error: { message: "slow down", type: "rate_limit_error" } }), { status: 429 });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }));
      const transport = createFetchTransport({ maxRetries: 2 });
      const response = await transport.send({ url: "https://example.test/x", headers: {}, body: {} });
      expect(response.json).toEqual({ ok: true });
      expect(call).toBe(2);
    });

    it("does not retry a 401 and normalizes it as a non-retriable auth error", async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key", code: "invalid_api_key" } }), { status: 401 }));
      vi.stubGlobal("fetch", fetchMock);
      const transport = createFetchTransport({ maxRetries: 3 });
      await expect(transport.send({ url: "https://example.test/x", headers: {}, body: {} })).rejects.toMatchObject({ kind: "auth", retriable: false, status: 401, providerCode: "invalid_api_key" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries a 500 to exhaustion then throws a normalized server error", async () => {
      const fetchMock = vi.fn(async () => new Response("upstream boom", { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);
      const transport = createFetchTransport({ maxRetries: 2 });
      const error = await transport.send({ url: "https://example.test/x", headers: {}, body: {} }).catch((e) => e);
      expect(error).toBeInstanceOf(AIProviderError);
      expect(error.kind).toBe("server");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("normalizes a network failure as retriable", async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      vi.stubGlobal("fetch", fetchMock);
      const transport = createFetchTransport({ maxRetries: 1 });
      await expect(transport.send({ url: "https://example.test/x", headers: {}, body: {} })).rejects.toMatchObject({ kind: "network", retriable: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
