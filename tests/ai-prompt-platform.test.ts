import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, authHeader, resetDatabase } from "./helpers.js";
import { routeAI } from "../src/lib/ai/aiGateway.js";
import { renderPrompt } from "../src/lib/ai/promptRender.js";
import { resolvePublishedPrompt, renderPublishedPrompt } from "../src/lib/ai/promptRegistry.js";
import { advanceAIConversation } from "../src/lib/ai/aiRuntime.js";
import { FAKE_AI_MODEL, FAKE_AI_PROVIDER_ID } from "../src/lib/ai/fakeAIProvider.js";

async function seedModel() {
  await prisma.aIModelRegistry.create({
    data: {
      provider: FAKE_AI_PROVIDER_ID,
      model: FAKE_AI_MODEL,
      version: "1",
      capabilities: ["conversation", "classification", "scheduling", "extraction"],
      approvedUseCases: ["conversation"],
      status: "ACTIVE",
      healthStatus: "HEALTHY",
    },
  });
}

/** Drives a template from nothing to a PUBLISHED v1 through the HTTP API. */
async function publishTemplate(
  app: FastifyInstance,
  token: string,
  opts: { body?: string; systemPrompt?: string; variables?: unknown[]; task?: string; key?: string } = {},
) {
  const pkg = await app
    .inject({ method: "POST", url: "/ai/prompts/packages", headers: authHeader(token), payload: { key: `pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: "Biz Prompts" } })
    .then((r) => r.json());
  const template = await app
    .inject({
      method: "POST",
      url: `/ai/prompts/packages/${pkg.id}/templates`,
      headers: authHeader(token),
      payload: { key: opts.key ?? "greeting", name: "Greeting", task: opts.task ?? "conversation" },
    })
    .then((r) => r.json());
  const version = await app
    .inject({
      method: "POST",
      url: `/ai/prompts/templates/${template.id}/versions`,
      headers: authHeader(token),
      payload: {
        body: opts.body ?? "Hello {{name}}, welcome to {{place}}.",
        systemPrompt: opts.systemPrompt,
        variables: opts.variables ?? [
          { name: "name", required: true },
          { name: "place", required: false, defaultValue: "our shop" },
        ],
      },
    })
    .then((r) => r.json());
  const approval = await app
    .inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/approval-request`, headers: authHeader(token), payload: {} })
    .then((r) => r.json());
  await app.inject({ method: "POST", url: `/ai/prompts/approvals/${approval.id}/decision`, headers: authHeader(token), payload: { approve: true } });
  const published = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/publish`, headers: authHeader(token), payload: {} });
  return { pkg, template, version, published };
}

describe("AI prompt platform (3B-1)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("publishes a version only after an approved review and then resolves it", async () => {
    const { token } = await registerAccount(app);
    const { template, version, published } = await publishTemplate(app, token);
    expect(published.statusCode).toBe(200);
    expect(published.json().version.status).toBe("PUBLISHED");

    const refreshed = await app.inject({ method: "GET", url: `/ai/prompts/templates/${template.id}`, headers: authHeader(token) }).then((r) => r.json());
    expect(refreshed.currentVersionId).toBe(version.id);
    expect(refreshed.status).toBe("PUBLISHED");
    expect(refreshed.deployments).toHaveLength(1);

    const resolved = await resolvePublishedPrompt({ templateKey: "greeting", businessId: refreshed.package.businessId, packageKey: refreshed.package.key });
    expect(resolved.versionId).toBe(version.id);
    expect(resolved.source).toBe("platform");
  });

  it("rejects publishing a version that has no approved review", async () => {
    const { token } = await registerAccount(app);
    const pkg = await app.inject({ method: "POST", url: "/ai/prompts/packages", headers: authHeader(token), payload: { key: "pkg-noapprove", name: "P" } }).then((r) => r.json());
    const template = await app
      .inject({ method: "POST", url: `/ai/prompts/packages/${pkg.id}/templates`, headers: authHeader(token), payload: { key: "t", name: "T", task: "conversation" } })
      .then((r) => r.json());
    const version = await app
      .inject({ method: "POST", url: `/ai/prompts/templates/${template.id}/versions`, headers: authHeader(token), payload: { body: "Hi {{name}}", variables: [{ name: "name", required: true }] } })
      .then((r) => r.json());

    const denied = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/publish`, headers: authHeader(token), payload: {} });
    expect(denied.statusCode).toBe(403);

    const approval = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/approval-request`, headers: authHeader(token), payload: {} }).then((r) => r.json());
    await app.inject({ method: "POST", url: `/ai/prompts/approvals/${approval.id}/decision`, headers: authHeader(token), payload: { approve: false, reason: "tone" } });
    const stillDenied = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/publish`, headers: authHeader(token), payload: {} });
    expect(stillDenied.statusCode).toBe(403);
  });

  it("treats published versions as immutable — a change is a new version", async () => {
    const { token } = await registerAccount(app);
    const { template, version } = await publishTemplate(app, token);

    const v2 = await app
      .inject({ method: "POST", url: `/ai/prompts/templates/${template.id}/versions`, headers: authHeader(token), payload: { body: "Second {{name}}", variables: [{ name: "name", required: true }] } })
      .then((r) => r.json());
    expect(v2.version).toBe(2);

    const v1 = await prisma.promptVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(v1.status).toBe("PUBLISHED");
    expect(v1.body).toContain("welcome to");
    // No route exists to mutate a version body — only publish/retire transitions.
  });

  it("retiring the current version repoints the template and supersedes the deployment", async () => {
    const { token } = await registerAccount(app);
    const { template, version } = await publishTemplate(app, token);
    const retired = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/retire`, headers: authHeader(token), payload: {} });
    expect(retired.statusCode).toBe(200);
    const t = await prisma.promptTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(t.currentVersionId).toBeNull();
    expect(await prisma.promptDeployment.count({ where: { templateId: template.id, active: true } })).toBe(0);
  });

  it("renderPrompt enforces declared variables", () => {
    const variables = [
      { name: "name", type: "string", required: true },
      { name: "count", type: "number", required: false, defaultValue: "0" },
    ];
    const ok = renderPrompt({ body: "Hi {{name}} x{{count}}", variables, values: { name: "Ada" } });
    expect(ok.prompt).toBe("Hi Ada x0");
    expect(ok.checksum).toHaveLength(64);
    expect(renderPrompt({ body: "Hi {{name}}", variables, values: { name: "Ada" } }).checksum).toBe(
      renderPrompt({ body: "Hi {{name}}", variables, values: { name: "Ada" } }).checksum,
    );
    expect(() => renderPrompt({ body: "Hi {{name}}", variables, values: {} })).toThrow(/Missing required/);
    expect(() => renderPrompt({ body: "Hi {{name}}", variables, values: { name: "Ada", nope: 1 } })).toThrow(/Unknown prompt variable/);
    expect(() => renderPrompt({ body: "Hi {{name}} {{count}}", variables, values: { name: "Ada", count: "abc" } })).toThrow(/must be a number/);
  });

  it("POST /ai/prompts/resolve renders the published prompt with supplied values", async () => {
    const { token } = await registerAccount(app);
    await publishTemplate(app, token);
    const res = await app.inject({
      method: "POST",
      url: "/ai/prompts/resolve",
      headers: authHeader(token),
      payload: { templateKey: "greeting", values: { name: "Ada" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prompt).toBe("Hello Ada, welcome to our shop.");
    expect(res.json().source).toBe("platform");

    const missing = await app.inject({ method: "POST", url: "/ai/prompts/resolve", headers: authHeader(token), payload: { templateKey: "greeting", values: {} } });
    expect(missing.statusCode).toBe(400);
  });

  it("a business override takes precedence when resolving", async () => {
    const { token, businessId } = await registerAccount(app);
    const { template } = await publishTemplate(app, token);
    const set = await app.inject({
      method: "PUT",
      url: `/ai/prompts/templates/${template.id}/override`,
      headers: authHeader(token),
      payload: { body: "Override hi {{name}}" },
    });
    expect(set.statusCode).toBe(200);
    const resolved = await renderPublishedPrompt({ templateKey: "greeting", businessId, values: { name: "Zed" } });
    expect(resolved.source).toBe("override");
    expect(resolved.rendered.prompt).toBe("Override hi Zed");
  });

  it("a locale-specific localization is layered on the resolved prompt", async () => {
    const { token, businessId } = await registerAccount(app);
    const { version } = await publishTemplate(app, token);
    await app.inject({
      method: "POST",
      url: `/ai/prompts/versions/${version.id}/localizations`,
      headers: authHeader(token),
      payload: { locale: "fr", body: "Bonjour {{name}}", systemPrompt: null },
    });
    const resolved = await resolvePublishedPrompt({ templateKey: "greeting", businessId, locale: "fr" });
    expect(resolved.source).toBe("localization");
    expect(resolved.body).toBe("Bonjour {{name}}");
  });

  it("routeAI executes a published version and rejects a draft one", async () => {
    const { token, businessId } = await registerAccount(app);
    await seedModel();
    const { template, version } = await publishTemplate(app, token, { body: "Say hi to {{name}}", variables: [{ name: "name", required: true }] });

    const draft = await app
      .inject({ method: "POST", url: `/ai/prompts/templates/${template.id}/versions`, headers: authHeader(token), payload: { body: "Draft {{name}}", variables: [{ name: "name", required: true }] } })
      .then((r) => r.json());

    const ok = await routeAI({ businessId, task: "conversation", prompt: "Say hi to Ada", context: {}, promptVersionId: version.id });
    expect(ok.ledgerId).toBeDefined();
    const ledger = await prisma.aIInvocationLedger.findUniqueOrThrow({ where: { id: ok.ledgerId } });
    expect(ledger.promptVersion).toBe(version.id);
    expect(ledger.outcome).toBe("COMPLETED");

    await expect(
      routeAI({ businessId, task: "conversation", prompt: "Draft Ada", context: {}, promptVersionId: draft.id }),
    ).rejects.toThrow(/published prompt version/);
  });

  it("advanceAIConversation resolves the seeded orchestrator prompt", async () => {
    const { businessId } = await registerAccount(app);
    await seedModel();
    // Seed a minimal platform orchestrator template published.
    const pkg = await prisma.promptPackage.create({ data: { key: "platform", name: "Platform", scope: "PLATFORM", status: "PUBLISHED" } });
    const template = await prisma.promptTemplate.create({ data: { packageId: pkg.id, key: "conversation.orchestrator", name: "Orchestrator", task: "conversation" } });
    const version = await prisma.promptVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        status: "PUBLISHED",
        body: "Reply to: {{message}}",
        requiredCapability: "conversation",
        checksum: "seed",
        publishedAt: new Date(),
        variables: { create: [{ name: "message", required: true }] },
      },
    });
    await prisma.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: version.id } });

    const run = await prisma.aIConversationRun.create({
      data: { businessId, conversationId: "conv-1", idempotencyKey: "adv-1", status: "RECEIVED" },
    });
    const advanced = await advanceAIConversation({ businessId, runId: run.id, prompt: "hi there" });
    expect(advanced.status).toBe("COMPLETED");
    const ledger = await prisma.aIInvocationLedger.findFirstOrThrow({ where: { businessId } });
    expect(ledger.promptVersion).toBe(version.id);
  });

  it("runs stored test cases and records pass/fail per case", async () => {
    const { token } = await registerAccount(app);
    const { template, version } = await publishTemplate(app, token, { body: "Greeting for {{name}}", variables: [{ name: "name", required: true }] });
    await app.inject({
      method: "POST",
      url: `/ai/prompts/templates/${template.id}/test-cases`,
      headers: authHeader(token),
      payload: { name: "has-conversation-tag", variables: { name: "Ada" }, assertions: [{ type: "contains", value: "conversation" }] },
    });
    await app.inject({
      method: "POST",
      url: `/ai/prompts/templates/${template.id}/test-cases`,
      headers: authHeader(token),
      payload: { name: "impossible", variables: { name: "Ada" }, assertions: [{ type: "contains", value: "__never__" }] },
    });
    const runRes = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/test-runs`, headers: authHeader(token), payload: {} });
    expect(runRes.statusCode).toBe(201);
    const summary = runRes.json();
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);

    const runs = await app.inject({ method: "GET", url: `/ai/prompts/versions/${version.id}/test-runs`, headers: authHeader(token) }).then((r) => r.json());
    expect(runs).toHaveLength(2);
    expect(runs.map((r: { status: string }) => r.status).sort()).toEqual(["FAILED", "PASSED"]);
  });

  it("isolates prompt templates between businesses", async () => {
    const a = await registerAccount(app);
    const b = await registerAccount(app);
    const { template, version } = await publishTemplate(app, a.token);

    const cross = await app.inject({ method: "GET", url: `/ai/prompts/templates/${template.id}`, headers: authHeader(b.token) });
    expect(cross.statusCode).toBe(404);
    const crossPublish = await app.inject({ method: "POST", url: `/ai/prompts/versions/${version.id}/retire`, headers: authHeader(b.token), payload: {} });
    expect(crossPublish.statusCode).toBe(404);
  });

  it("blocks mutating the shared platform package through the business API", async () => {
    const { token } = await registerAccount(app);
    const pkg = await prisma.promptPackage.create({ data: { key: "platform", name: "Platform", scope: "PLATFORM", status: "PUBLISHED" } });
    const res = await app.inject({
      method: "POST",
      url: `/ai/prompts/packages/${pkg.id}/templates`,
      headers: authHeader(token),
      payload: { key: "x", name: "X", task: "conversation" },
    });
    expect(res.statusCode).toBe(403);
  });
});
