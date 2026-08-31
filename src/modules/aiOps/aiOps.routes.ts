import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBusinessRole } from "../../lib/authorization.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { getAIMonitoring } from "../../lib/ai/ops/aiMonitoring.js";
import { getAITrend } from "../../lib/ai/ops/aiMetrics.js";
import { circuitBreakerSnapshot } from "../../lib/ai/ops/circuitBreaker.js";
import { getAIValueCenter, attributeAIOutcome, verifyAIOutcomes } from "../../lib/ai/ops/aiAnalytics.js";
import {
  addEvaluationCase,
  compareEvaluationRuns,
  createEvaluationSuite,
  getEvaluationRun,
  listSuiteRuns,
  runEvaluation,
} from "../../lib/ai/ops/evaluationHarness.js";
import { recordConversationEvent } from "../../lib/ai/memory/summarization.js";
import {
  addCaseSchema,
  approveRunSchema,
  compareRunsSchema,
  createSuiteSchema,
  runListQuerySchema,
  runSuiteSchema,
  trendQuerySchema,
  windowQuerySchema,
} from "./aiOps.schemas.js";

const idParams = z.object({ id: z.string().uuid() });
const MANAGE_ROLES = ["OWNER", "ADMIN"] as const;

async function ownedSuite(businessId: string, suiteId: string) {
  const suite = await prisma.aIEvaluationSuite.findUnique({ where: { id: suiteId } });
  if (!suite || (suite.businessId && suite.businessId !== businessId)) throw ApiError.notFound("Evaluation suite not found");
  if (!suite.businessId) throw ApiError.forbidden("Platform evaluation suites are managed by Chakusa administration");
  return suite;
}

async function ownedRun(businessId: string, runId: string) {
  const run = await prisma.aIConversationRun.findFirst({ where: { id: runId, businessId } });
  if (!run) throw ApiError.notFound("AI conversation run not found");
  return run;
}

export default async function aiOpsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/monitoring", async (request) => {
    const { sinceHours } = windowQuerySchema.parse(request.query);
    return getAIMonitoring({ businessId: request.businessId! }, sinceHours);
  });

  fastify.get("/trends", async (request) => {
    const query = trendQuerySchema.parse(request.query);
    return { metric: query.metric, bucket: query.bucket, points: await getAITrend({ businessId: request.businessId!, ...query }) };
  });

  fastify.get("/health", async (request) => {
    const monitoring = await getAIMonitoring({ businessId: request.businessId! }, 24);
    return { providerHealth: monitoring.providerHealth, circuitBreaker: circuitBreakerSnapshot(), aiFailureRate: monitoring.aiFailureRate };
  });

  fastify.get("/analytics", async (request) => getAIValueCenter(request.businessId!));

  fastify.post("/analytics/verify", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    return verifyAIOutcomes(request.businessId!);
  });

  // --- Evaluation harness ---

  fastify.post("/evaluations/suites", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const input = createSuiteSchema.parse(request.body);
    reply.status(201).send(await createEvaluationSuite({ businessId: request.businessId!, createdByUserId: request.user!.userId, ...input }));
  });

  fastify.post("/evaluations/suites/:id/cases", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await ownedSuite(request.businessId!, id);
    const input = addCaseSchema.parse(request.body);
    reply.status(201).send(
      await addEvaluationCase({
        suiteId: id,
        businessId: request.businessId!,
        name: input.name,
        caseInput: input.input,
        expected: input.expected,
        locale: input.locale ?? null,
        weight: input.weight,
        promptTemplateKey: input.promptTemplateKey ?? null,
        tags: input.tags,
      }),
    );
  });

  fastify.post("/evaluations/suites/:id/run", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await ownedSuite(request.businessId!, id);
    const input = runSuiteSchema.parse(request.body ?? {});
    reply.status(201).send(
      await runEvaluation({
        suiteId: id,
        businessId: request.businessId!,
        promptVersionId: input.promptVersionId ?? null,
        compareToRunId: input.compareToRunId ?? null,
        label: input.label ?? null,
        createdByUserId: request.user!.userId,
      }),
    );
  });

  fastify.get("/evaluations/suites/:id/runs", async (request) => {
    const { id } = idParams.parse(request.params);
    await ownedSuite(request.businessId!, id);
    return listSuiteRuns(id);
  });

  fastify.get("/evaluations/runs/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const run = await getEvaluationRun(id);
    if (run.businessId && run.businessId !== request.businessId) throw ApiError.notFound("Evaluation run not found");
    return run;
  });

  fastify.post("/evaluations/compare", async (request) => {
    const { runIdA, runIdB } = compareRunsSchema.parse(request.body);
    for (const runId of [runIdA, runIdB]) {
      const run = await prisma.aIEvaluationRun.findUnique({ where: { id: runId }, select: { businessId: true } });
      if (!run || (run.businessId && run.businessId !== request.businessId)) throw ApiError.notFound("Evaluation run not found");
    }
    return compareEvaluationRuns(runIdA, runIdB);
  });

  // --- Conversation history / draft review / approval ---

  fastify.get("/runs", async (request) => {
    const query = runListQuerySchema.parse(request.query);
    return prisma.aIConversationRun.findMany({
      where: { businessId: request.businessId!, ...(query.status ? { status: query.status } : {}) },
      orderBy: { updatedAt: "desc" },
      take: query.limit,
    });
  });

  fastify.get("/runs/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    return ownedRun(request.businessId!, id);
  });

  fastify.post("/runs/:id/approve", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    const run = await ownedRun(request.businessId!, id);
    if (run.status !== "HUMAN_APPROVAL") throw ApiError.badRequest("Only a run awaiting approval can be approved");
    const input = approveRunSchema.parse(request.body ?? {});
    const updated = await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
    await recordConversationEvent({
      businessId: request.businessId!,
      conversationId: run.conversationId,
      runId: run.id,
      customerId: run.customerId ?? undefined,
      kind: "human_intervention",
      content: `Draft approved by ${request.user!.userId}.`,
    });
    if (input.attributeOutcome) {
      await attributeAIOutcome({
        businessId: request.businessId!,
        runId: run.id,
        conversationId: run.conversationId,
        customerId: run.customerId ?? undefined,
        outcomeType: input.attributeOutcome.outcomeType,
        outcomeId: input.attributeOutcome.outcomeId,
        amount: input.attributeOutcome.amount ?? null,
        currency: input.attributeOutcome.currency ?? null,
      });
    }
    return updated;
  });

  fastify.post("/runs/:id/escalate", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    const run = await ownedRun(request.businessId!, id);
    const updated = await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "ESCALATED" } });
    await recordConversationEvent({
      businessId: request.businessId!,
      conversationId: run.conversationId,
      runId: run.id,
      customerId: run.customerId ?? undefined,
      kind: "human_intervention",
      content: `Run escalated by ${request.user!.userId}.`,
    });
    return updated;
  });
}
