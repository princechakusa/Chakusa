import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { renderPrompt } from "./promptRender.js";
import { createFakeAIProvider } from "./fakeAIProvider.js";
import type { AIProvider, AITask } from "./aiGateway.js";

export type AssertionType = "contains" | "notContains" | "equals" | "matches" | "minConfidence";
export interface PromptAssertion {
  type: AssertionType;
  value: string | number;
}

const ASSERTION_TYPES: AssertionType[] = ["contains", "notContains", "equals", "matches", "minConfidence"];

export function assertValidAssertions(assertions: unknown): PromptAssertion[] {
  if (!Array.isArray(assertions)) throw ApiError.badRequest("assertions must be an array");
  return assertions.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw ApiError.badRequest(`assertions[${index}] must be an object`);
    const { type, value } = raw as Record<string, unknown>;
    if (typeof type !== "string" || !ASSERTION_TYPES.includes(type as AssertionType)) {
      throw ApiError.badRequest(`assertions[${index}].type is invalid`);
    }
    if (type === "minConfidence") {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw ApiError.badRequest(`assertions[${index}].value must be a number`);
      return { type, value: n };
    }
    if (typeof value !== "string") throw ApiError.badRequest(`assertions[${index}].value must be a string`);
    return { type: type as AssertionType, value };
  });
}

export async function createPromptTestCase(input: {
  templateId: string;
  name: string;
  variables?: Record<string, unknown>;
  context?: Record<string, unknown> | null;
  assertions: unknown;
}) {
  const template = await prisma.promptTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw ApiError.notFound("Prompt template not found");
  const assertions = assertValidAssertions(input.assertions);
  return prisma.promptTestCase.upsert({
    where: { templateId_name: { templateId: input.templateId, name: input.name } },
    create: {
      templateId: input.templateId,
      name: input.name,
      variables: (input.variables ?? {}) as never,
      context: (input.context ?? undefined) as never,
      assertions: assertions as never,
    },
    update: { variables: (input.variables ?? {}) as never, context: (input.context ?? undefined) as never, assertions: assertions as never },
  });
}

function evaluate(assertions: PromptAssertion[], text: string, confidence: number): string[] {
  const failures: string[] = [];
  for (const assertion of assertions) {
    switch (assertion.type) {
      case "contains":
        if (!text.includes(String(assertion.value))) failures.push(`expected output to contain "${assertion.value}"`);
        break;
      case "notContains":
        if (text.includes(String(assertion.value))) failures.push(`expected output not to contain "${assertion.value}"`);
        break;
      case "equals":
        if (text !== String(assertion.value)) failures.push(`expected output to equal "${assertion.value}"`);
        break;
      case "matches":
        if (!new RegExp(String(assertion.value)).test(text)) failures.push(`expected output to match /${assertion.value}/`);
        break;
      case "minConfidence":
        if (confidence < Number(assertion.value)) failures.push(`confidence ${confidence.toFixed(2)} below minimum ${assertion.value}`);
        break;
    }
  }
  return failures;
}

/**
 * Renders every stored test case for a version's template and runs it
 * through a provider (the deterministic fake by default), recording one
 * PromptTestRun per case. Returns the pass/fail tally.
 */
export async function runPromptTests(input: { versionId: string; provider?: AIProvider }) {
  const version = await prisma.promptVersion.findUnique({
    where: { id: input.versionId },
    include: { variables: true, template: true },
  });
  if (!version) throw ApiError.notFound("Prompt version not found");
  const provider = input.provider ?? createFakeAIProvider();
  const cases = await prisma.promptTestCase.findMany({ where: { templateId: version.templateId }, orderBy: { name: "asc" } });
  if (!cases.length) throw ApiError.badRequest("This template has no test cases");

  const runs = [];
  let passed = 0;
  for (const testCase of cases) {
    const started = Date.now();
    let status: "PASSED" | "FAILED" | "ERROR" = "PASSED";
    let failures: string[] = [];
    let output: unknown = null;
    try {
      const rendered = renderPrompt({
        body: version.body,
        systemPrompt: version.systemPrompt,
        variables: version.variables,
        values: (testCase.variables ?? {}) as Record<string, unknown>,
      });
      const result = await provider.invoke({
        model: version.model ?? "chakusa-fake-1",
        task: version.template.task as AITask,
        prompt: rendered.prompt,
        context: testCase.context ?? {},
        tools: [],
      });
      output = result.output;
      const text = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
      failures = evaluate(assertValidAssertions(testCase.assertions), text, result.confidence ?? 0);
      status = failures.length ? "FAILED" : "PASSED";
    } catch (error) {
      status = "ERROR";
      failures = [error instanceof Error ? error.message : "unknown error"];
    }
    if (status === "PASSED") passed += 1;
    const run = await prisma.promptTestRun.create({
      data: {
        versionId: version.id,
        testCaseId: testCase.id,
        status,
        provider: provider.id,
        model: version.model ?? null,
        output: (output ?? undefined) as never,
        failures: failures.length ? (failures as never) : undefined,
        durationMs: Date.now() - started,
      },
    });
    runs.push(run);
  }
  return { versionId: version.id, total: cases.length, passed, failed: cases.length - passed, runs };
}

export async function listPromptTestRuns(versionId: string) {
  return prisma.promptTestRun.findMany({ where: { versionId }, orderBy: { createdAt: "desc" }, take: 100 });
}
