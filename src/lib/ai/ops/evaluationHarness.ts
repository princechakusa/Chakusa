import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";
import { createFakeAIProvider } from "../fakeAIProvider.js";
import { detectPromptInjection, scanModelOutput } from "../safety.js";
import { renderPrompt } from "../promptRender.js";
import { getPublishedVersionOrThrow } from "../promptRegistry.js";
import type { AIProvider } from "../aiGateway.js";

export const EVALUATION_CATEGORIES = [
  "intent_classification",
  "tool_selection",
  "prompt_regression",
  "prompt_comparison",
  "hallucination",
  "safety_regression",
  "structured_output",
  "booking_accuracy",
  "quote_accuracy",
  "payment_workflow",
  "review_request",
  "multilingual",
] as const;
export type EvaluationCategory = (typeof EVALUATION_CATEGORIES)[number];

type Json = Record<string, unknown>;

export async function createEvaluationSuite(input: {
  businessId?: string | null;
  key: string;
  name: string;
  category: string;
  description?: string | null;
  createdByUserId?: string | null;
}) {
  if (!EVALUATION_CATEGORIES.includes(input.category as EvaluationCategory)) {
    throw ApiError.badRequest(`Unknown evaluation category: ${input.category}`);
  }
  return prisma.aIEvaluationSuite.create({
    data: {
      businessId: input.businessId ?? null,
      key: input.key,
      name: input.name,
      category: input.category,
      description: input.description ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export async function addEvaluationCase(input: {
  suiteId: string;
  businessId?: string | null;
  name: string;
  caseInput: Json;
  expected: Json;
  locale?: string | null;
  weight?: number;
  promptTemplateKey?: string | null;
  tags?: unknown;
}) {
  const suite = await prisma.aIEvaluationSuite.findUnique({ where: { id: input.suiteId } });
  if (!suite) throw ApiError.notFound("Evaluation suite not found");
  return prisma.aIEvaluationCase.upsert({
    where: { suiteId_name: { suiteId: input.suiteId, name: input.name } },
    create: {
      suiteId: input.suiteId,
      businessId: input.businessId ?? suite.businessId,
      name: input.name,
      input: input.caseInput as Prisma.InputJsonValue,
      expected: input.expected as Prisma.InputJsonValue,
      locale: input.locale ?? null,
      weight: input.weight ?? 1,
      promptTemplateKey: input.promptTemplateKey ?? null,
      tags: (input.tags ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    update: {
      input: input.caseInput as Prisma.InputJsonValue,
      expected: input.expected as Prisma.InputJsonValue,
      locale: input.locale ?? null,
      weight: input.weight ?? 1,
      promptTemplateKey: input.promptTemplateKey ?? null,
    },
  });
}

// --- grading -------------------------------------------------------------

interface CaseVerdict {
  passed: boolean;
  score: number;
  failureReason?: string;
  checks: Record<string, boolean>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function gradeStructured(actual: unknown, schema: Json): CaseVerdict {
  const checks: Record<string, boolean> = {};
  const obj = actual && typeof actual === "object" && !Array.isArray(actual) ? (actual as Json) : null;
  checks.isObject = obj !== null;
  const requiredKeys = Array.isArray(schema.requiredKeys) ? (schema.requiredKeys as string[]) : [];
  const types = (schema.types && typeof schema.types === "object" ? schema.types : {}) as Record<string, string>;
  for (const key of requiredKeys) checks[`has:${key}`] = Boolean(obj && key in obj);
  for (const [key, type] of Object.entries(types)) checks[`type:${key}`] = Boolean(obj && typeof obj[key] === type);
  const passedChecks = Object.values(checks).filter(Boolean).length;
  const score = Object.keys(checks).length ? passedChecks / Object.keys(checks).length : 0;
  return { passed: score === 1, score, failureReason: score === 1 ? undefined : "structured output did not satisfy schema", checks };
}

function gradeFields(actual: unknown, expectedFields: Json): CaseVerdict {
  const obj = actual && typeof actual === "object" ? (actual as Json) : {};
  const checks: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(expectedFields)) {
    checks[key] = JSON.stringify(obj[key]) === JSON.stringify(value);
  }
  const passedChecks = Object.values(checks).filter(Boolean).length;
  const score = Object.keys(checks).length ? passedChecks / Object.keys(checks).length : 0;
  return { passed: score === 1, score, failureReason: score === 1 ? undefined : "one or more fields did not match", checks };
}

function gradeText(actualText: string, expected: Json): CaseVerdict {
  const checks: Record<string, boolean> = {};
  if (typeof expected.equals === "string") checks.equals = actualText.trim() === expected.equals.trim();
  for (const term of (expected.contains as string[] | undefined) ?? []) checks[`contains:${term}`] = actualText.includes(term);
  for (const term of (expected.notContains as string[] | undefined) ?? []) checks[`notContains:${term}`] = !actualText.includes(term);
  if (typeof expected.matches === "string") checks.matches = new RegExp(expected.matches).test(actualText);
  const total = Object.keys(checks).length || 1;
  const score = Object.values(checks).filter(Boolean).length / total;
  return { passed: score === 1, score, failureReason: score === 1 ? undefined : "text expectations not met", checks };
}

function gradeCase(category: EvaluationCategory, caseInput: Json, expected: Json, actual: unknown): CaseVerdict {
  switch (category) {
    case "intent_classification": {
      const got = String((actual as Json)?.label ?? actual ?? "").toLowerCase();
      const want = String(expected.label ?? "").toLowerCase();
      return { passed: got === want, score: got === want ? 1 : 0, failureReason: got === want ? undefined : `expected intent "${want}", got "${got}"`, checks: { label: got === want } };
    }
    case "tool_selection": {
      const got = String((actual as Json)?.tool ?? actual ?? "");
      const want = String(expected.tool ?? "");
      return { passed: got === want, score: got === want ? 1 : 0, failureReason: got === want ? undefined : `expected tool "${want}", got "${got}"`, checks: { tool: got === want } };
    }
    case "structured_output":
      return gradeStructured(actual, (expected.schema as Json) ?? expected);
    case "booking_accuracy":
    case "quote_accuracy":
    case "payment_workflow":
    case "review_request":
      return gradeFields(actual, (expected.fields as Json) ?? expected);
    case "safety_regression": {
      const text = `${asText(caseInput.prompt)} ${asText(caseInput.text)}`;
      const injection = detectPromptInjection(text);
      const unsafe = scanModelOutput(asText(actual)).length > 0;
      const blocked = injection || unsafe;
      const want = expected.blocked !== false;
      return { passed: blocked === want, score: blocked === want ? 1 : 0, failureReason: blocked === want ? undefined : `expected blocked=${want}, detected=${blocked}`, checks: { injection, unsafe, blocked } };
    }
    case "hallucination": {
      const text = asText(actual);
      const checks: Record<string, boolean> = {};
      for (const term of (expected.groundedTerms as string[] | undefined) ?? []) checks[`grounded:${term}`] = text.includes(term);
      for (const claim of (expected.forbiddenClaims as string[] | undefined) ?? []) checks[`noClaim:${claim}`] = !text.toLowerCase().includes(claim.toLowerCase());
      const total = Object.keys(checks).length || 1;
      const score = Object.values(checks).filter(Boolean).length / total;
      return { passed: score === 1, score, failureReason: score === 1 ? undefined : "hallucination checks failed", checks };
    }
    case "multilingual": {
      const text = asText(actual);
      const checks: Record<string, boolean> = { nonEmpty: text.trim().length > 0 };
      for (const term of (expected.contains as string[] | undefined) ?? []) checks[`contains:${term}`] = text.includes(term);
      const total = Object.keys(checks).length || 1;
      const score = Object.values(checks).filter(Boolean).length / total;
      return { passed: score === 1, score, failureReason: score === 1 ? undefined : "localized output expectations not met", checks };
    }
    case "prompt_regression":
    case "prompt_comparison":
    default:
      return gradeText(asText(actual), expected);
  }
}

// --- running -----------------------------------------------------------

async function resolveActual(
  category: EvaluationCategory,
  caseInput: Json,
  provider: AIProvider,
  promptVersionId: string | null,
): Promise<{ actual: unknown; latencyMs: number }> {
  if (caseInput.mockResponse !== undefined) return { actual: caseInput.mockResponse, latencyMs: 0 };
  const started = Date.now();
  let prompt = asText(caseInput.prompt);
  if (promptVersionId) {
    const version = await getPublishedVersionOrThrow(promptVersionId);
    prompt = renderPrompt({
      body: version.body,
      systemPrompt: version.systemPrompt,
      variables: version.variables,
      values: (caseInput.variables as Json) ?? {},
    }).prompt;
  }
  const result = await provider.invoke({
    model: "chakusa-fake-1",
    task: category === "intent_classification" ? "classification" : "conversation",
    prompt,
    context: caseInput.context ?? {},
    tools: [],
  });
  return { actual: result.output, latencyMs: Date.now() - started };
}

/**
 * Executes a suite, producing a versioned AIEvaluationRun plus one
 * AIEvaluationResult per case. Optionally compares against a baseline run.
 */
export async function runEvaluation(input: {
  suiteId: string;
  businessId?: string | null;
  promptVersionId?: string | null;
  compareToRunId?: string | null;
  label?: string | null;
  provider?: AIProvider;
  createdByUserId?: string | null;
}) {
  const suite = await prisma.aIEvaluationSuite.findUnique({ where: { id: input.suiteId }, include: { cases: true } });
  if (!suite) throw ApiError.notFound("Evaluation suite not found");
  if (!suite.cases.length) throw ApiError.badRequest("Evaluation suite has no cases");
  const provider = input.provider ?? createFakeAIProvider();
  const category = suite.category as EvaluationCategory;

  const last = await prisma.aIEvaluationRun.findFirst({ where: { suiteId: suite.id }, orderBy: { runNumber: "desc" }, select: { runNumber: true } });
  const runNumber = (last?.runNumber ?? 0) + 1;

  const run = await prisma.aIEvaluationRun.create({
    data: {
      businessId: input.businessId ?? suite.businessId,
      suiteId: suite.id,
      runNumber,
      label: input.label ?? null,
      promptVersionId: input.promptVersionId ?? null,
      compareToRunId: input.compareToRunId ?? null,
      status: "RUNNING",
      provider: provider.id,
      model: "chakusa-fake-1",
      totalCases: suite.cases.length,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  let weightedScore = 0;
  let totalWeight = 0;
  let passed = 0;
  const latencies: number[] = [];
  const perCategory: Record<string, { pass: number; total: number }> = {};

  for (const testCase of suite.cases) {
    const caseInput = (testCase.input as Json) ?? {};
    const expected = (testCase.expected as Json) ?? {};
    let verdict: CaseVerdict;
    let latencyMs = 0;
    try {
      const resolved = await resolveActual(category, caseInput, provider, input.promptVersionId ?? null);
      latencyMs = resolved.latencyMs;
      verdict = gradeCase(category, caseInput, expected, resolved.actual);
      await prisma.aIEvaluationResult.create({
        data: {
          runId: run.id,
          caseId: testCase.id,
          businessId: run.businessId,
          name: testCase.name,
          passed: verdict.passed,
          score: verdict.score,
          expected: expected as Prisma.InputJsonValue,
          actual: (resolved.actual ?? null) as Prisma.InputJsonValue,
          failureReason: verdict.failureReason ?? null,
          latencyMs,
          checks: verdict.checks as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      verdict = { passed: false, score: 0, failureReason: error instanceof Error ? error.message : "evaluation error", checks: {} };
      await prisma.aIEvaluationResult.create({
        data: { runId: run.id, caseId: testCase.id, businessId: run.businessId, name: testCase.name, passed: false, score: 0, failureReason: verdict.failureReason, checks: {} },
      });
    }
    weightedScore += verdict.score * testCase.weight;
    totalWeight += testCase.weight;
    if (verdict.passed) passed += 1;
    latencies.push(latencyMs);
    const bucket = (perCategory[category] ??= { pass: 0, total: 0 });
    bucket.total += 1;
    if (verdict.passed) bucket.pass += 1;
  }

  const score = totalWeight ? Number((weightedScore / totalWeight).toFixed(4)) : 0;
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const metrics: Json = {
    category,
    accuracy: suite.cases.length ? Number((passed / suite.cases.length).toFixed(4)) : 0,
    weightedScore: score,
    avgLatencyMs,
    perCategory,
  };

  if (input.compareToRunId) {
    const baseline = await prisma.aIEvaluationRun.findUnique({ where: { id: input.compareToRunId }, include: { results: true } });
    if (baseline) {
      const baseByName = new Map(baseline.results.map((r) => [r.name, r.score]));
      const current = await prisma.aIEvaluationResult.findMany({ where: { runId: run.id } });
      const regressions: string[] = [];
      const improvements: string[] = [];
      for (const result of current) {
        const before = baseByName.get(result.name);
        if (before == null) continue;
        if (result.score < before - 1e-9) regressions.push(result.name);
        else if (result.score > before + 1e-9) improvements.push(result.name);
      }
      metrics.comparison = { baselineRunId: baseline.id, baselineScore: baseline.score, delta: Number((score - baseline.score).toFixed(4)), regressions, improvements };
    }
  }

  return prisma.aIEvaluationRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      passedCases: passed,
      failedCases: suite.cases.length - passed,
      score,
      metrics: metrics as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
    include: { results: true },
  });
}

export async function listSuiteRuns(suiteId: string) {
  return prisma.aIEvaluationRun.findMany({ where: { suiteId }, orderBy: { runNumber: "desc" }, take: 100 });
}

export async function getEvaluationRun(runId: string) {
  const run = await prisma.aIEvaluationRun.findUnique({ where: { id: runId }, include: { results: true, suite: true } });
  if (!run) throw ApiError.notFound("Evaluation run not found");
  return run;
}

export async function compareEvaluationRuns(runIdA: string, runIdB: string) {
  const [a, b] = await Promise.all([
    prisma.aIEvaluationRun.findUnique({ where: { id: runIdA }, include: { results: true } }),
    prisma.aIEvaluationRun.findUnique({ where: { id: runIdB }, include: { results: true } }),
  ]);
  if (!a || !b) throw ApiError.notFound("One or both evaluation runs were not found");
  const byName = new Map(a.results.map((r) => [r.name, r.score]));
  const cases = b.results.map((result) => ({
    name: result.name,
    baseline: byName.get(result.name) ?? null,
    candidate: result.score,
    delta: byName.has(result.name) ? Number((result.score - (byName.get(result.name) ?? 0)).toFixed(4)) : null,
  }));
  return {
    baselineRunId: a.id,
    candidateRunId: b.id,
    baselineScore: a.score,
    candidateScore: b.score,
    delta: Number((b.score - a.score).toFixed(4)),
    regressions: cases.filter((c) => c.delta != null && c.delta < 0).map((c) => c.name),
    improvements: cases.filter((c) => c.delta != null && c.delta > 0).map((c) => c.name),
    cases,
  };
}
