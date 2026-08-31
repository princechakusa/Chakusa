import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import {
  AI_MODES,
  DEFAULT_MODE,
  DEFAULT_POLICY_DOCUMENT,
  DEFAULT_RULES,
  policyDocumentSchema,
  ruleInputSchema,
  type AIMode,
  type RuleInput,
} from "./policyDefaults.js";
import { policyDocumentChecksum, resolveActivePolicy } from "./policyEngine.js";

const DRAFT = "DRAFT";
const ACTIVE = "ACTIVE";
const ARCHIVED = "ARCHIVED";

export async function getPolicyOverview(businessId: string) {
  const resolved = await resolveActivePolicy(businessId);
  const draft = await prisma.aIPolicy.findFirst({
    where: { businessId, scope: "BUSINESS", status: DRAFT },
    orderBy: { version: "desc" },
    include: { rules: true },
  });
  return {
    active: {
      isDefault: resolved.isDefault,
      policyId: resolved.policyId,
      version: resolved.version,
      mode: resolved.mode,
      document: resolved.document,
      rules: resolved.isDefault ? DEFAULT_RULES : resolved.rules,
    },
    draft: draft
      ? { policyId: draft.id, version: draft.version, mode: draft.mode as AIMode, document: draft.document, rules: draft.rules }
      : null,
  };
}

async function nextVersion(businessId: string): Promise<number> {
  const latest = await prisma.aIPolicy.findFirst({
    where: { businessId, scope: "BUSINESS" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

/**
 * Creates or updates the single working DRAFT for a business. Everything is
 * validated against policyDocumentSchema before it is stored, and every edit
 * is recorded in AIPolicyChange.
 */
export async function savePolicyDraft(input: {
  businessId: string;
  mode?: string;
  document: unknown;
  actorUserId?: string | null;
}) {
  if (input.mode && !AI_MODES.includes(input.mode as AIMode)) throw ApiError.badRequest(`Unknown AI mode: ${input.mode}`);
  const document = policyDocumentSchema.parse(input.document ?? {});
  const checksum = policyDocumentChecksum(document);

  const existing = await prisma.aIPolicy.findFirst({
    where: { businessId: input.businessId, scope: "BUSINESS", status: DRAFT },
    orderBy: { version: "desc" },
  });

  return prisma.$transaction(async (tx) => {
    let policy;
    let changeType: string;
    if (existing) {
      policy = await tx.aIPolicy.update({
        where: { id: existing.id },
        data: { mode: input.mode ?? existing.mode, document: document as Prisma.InputJsonValue, checksum },
      });
      changeType = "UPDATED";
    } else {
      policy = await tx.aIPolicy.create({
        data: {
          businessId: input.businessId,
          scope: "BUSINESS",
          version: await nextVersion(input.businessId),
          status: DRAFT,
          mode: input.mode ?? DEFAULT_MODE,
          document: document as Prisma.InputJsonValue,
          checksum,
          createdByUserId: input.actorUserId ?? null,
        },
      });
      changeType = "CREATED";
    }
    await tx.aIPolicyChange.create({
      data: {
        businessId: input.businessId,
        policyId: policy.id,
        version: policy.version,
        changeType,
        actorUserId: input.actorUserId ?? null,
        document: document as Prisma.InputJsonValue,
      },
    });
    return tx.aIPolicy.findUniqueOrThrow({ where: { id: policy.id }, include: { rules: true } });
  });
}

/** Replaces the rule set on the working draft (creating the draft if needed). */
export async function replacePolicyRules(input: { businessId: string; rules: unknown; actorUserId?: string | null }) {
  const rules: RuleInput[] = Array.isArray(input.rules)
    ? input.rules.map((raw) => ruleInputSchema.parse(raw))
    : (() => {
        throw ApiError.badRequest("rules must be an array");
      })();

  let draft = await prisma.aIPolicy.findFirst({ where: { businessId: input.businessId, scope: "BUSINESS", status: DRAFT }, orderBy: { version: "desc" } });
  if (!draft) {
    const created = await savePolicyDraft({ businessId: input.businessId, document: DEFAULT_POLICY_DOCUMENT, actorUserId: input.actorUserId });
    draft = created;
  }
  const draftId = draft.id;

  return prisma.$transaction(async (tx) => {
    await tx.aIPolicyRule.deleteMany({ where: { policyId: draftId } });
    for (const rule of rules) {
      await tx.aIPolicyRule.create({
        data: {
          businessId: input.businessId,
          policyId: draftId,
          category: rule.category,
          action: rule.action,
          toolName: rule.toolName ?? null,
          workflowId: rule.workflowId ?? null,
          effect: rule.effect,
          strategy: rule.strategy,
          approverUserId: rule.approverUserId ?? null,
          minConfidence: rule.minConfidence ?? null,
          note: rule.note ?? null,
        },
      });
    }
    return tx.aIPolicy.findUniqueOrThrow({ where: { id: draftId }, include: { rules: true } });
  });
}

/**
 * Promotes the working draft (or a given version) to ACTIVE, archiving the
 * previously active policy and copying the draft's rules onto a fresh
 * immutable active row is unnecessary — the same row transitions, and its
 * rules travel with it.
 */
export async function activatePolicy(input: { businessId: string; version?: number; actorUserId?: string | null }) {
  const target = input.version
    ? await prisma.aIPolicy.findFirst({ where: { businessId: input.businessId, scope: "BUSINESS", version: input.version } })
    : await prisma.aIPolicy.findFirst({ where: { businessId: input.businessId, scope: "BUSINESS", status: DRAFT }, orderBy: { version: "desc" } });
  if (!target) throw ApiError.notFound("No policy draft to activate");
  if (target.status === ACTIVE) return prisma.aIPolicy.findUniqueOrThrow({ where: { id: target.id }, include: { rules: true } });

  return prisma.$transaction(async (tx) => {
    await tx.aIPolicy.updateMany({
      where: { businessId: input.businessId, scope: "BUSINESS", status: ACTIVE },
      data: { status: ARCHIVED, archivedAt: new Date() },
    });
    const activated = await tx.aIPolicy.update({
      where: { id: target.id },
      data: { status: ACTIVE, activatedAt: new Date() },
    });
    await tx.aIPolicyChange.create({
      data: {
        businessId: input.businessId,
        policyId: activated.id,
        version: activated.version,
        changeType: "ACTIVATED",
        actorUserId: input.actorUserId ?? null,
        document: activated.document as Prisma.InputJsonValue,
      },
    });
    return tx.aIPolicy.findUniqueOrThrow({ where: { id: activated.id }, include: { rules: true } });
  });
}

export async function listPolicyHistory(businessId: string) {
  const [policies, changes] = await Promise.all([
    prisma.aIPolicy.findMany({ where: { businessId, scope: "BUSINESS" }, orderBy: { version: "desc" }, include: { rules: true } }),
    prisma.aIPolicyChange.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return { policies, changes };
}

export async function listPolicyDecisions(businessId: string, limit = 100) {
  return prisma.aIPolicyDecision.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 500) });
}
