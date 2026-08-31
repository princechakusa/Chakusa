import { createHash } from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { parseWorkingHours, zonedParts, minutesOfDay, type WeeklyHours } from "../workingHours.js";
import { detectPromptInjection, scanModelOutput } from "./safety.js";
import { emitAIEvent } from "./ops/aiMetrics.js";
import {
  DEFAULT_MODE,
  DEFAULT_POLICY_DOCUMENT,
  DEFAULT_RULES,
  policyDocumentSchema,
  type AIMode,
  type EvaluableRule,
  type PolicyCheckpoint,
  type PolicyDocument,
  type PolicyEffect,
} from "./policyDefaults.js";

export type { AIMode, PolicyCheckpoint, PolicyEffect } from "./policyDefaults.js";

export interface PolicyReason {
  code: string;
  message: string;
  stage: string;
}

export interface PolicyRequest {
  businessId: string;
  checkpoint: PolicyCheckpoint;
  action: string;
  toolName?: string;
  workflowId?: string;
  workflowExecutionId?: string;
  runId?: string;
  conversationId?: string;
  customerId?: string;
  confidence?: number;
  channel?: string;
  purpose?: string;
  topics?: string[];
  promptText?: string;
  outputText?: string;
  now?: Date;
  correlationId?: string;
  dryRun?: boolean;
}

export interface PolicyResult {
  effect: PolicyEffect;
  mode: AIMode;
  allowed: boolean;
  reasons: PolicyReason[];
  requiredApprovalStrategy?: string;
  decisionId: string;
  policyId?: string;
  policyVersion?: number;
  isDefaultPolicy: boolean;
}

const SEVERITY: Record<PolicyEffect, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, ESCALATE: 2, DENY: 3 };
const OUTWARD: PolicyCheckpoint[] = ["TOOL_EXECUTION", "CUSTOMER_RESPONSE", "WORKFLOW_EXECUTION"];

interface ResolvedPolicy {
  policyId: string | null;
  version: number | null;
  mode: AIMode;
  document: PolicyDocument;
  rules: EvaluableRule[];
  isDefault: boolean;
}

/**
 * The active policy for a business: a per-workflow ACTIVE override wins over
 * the business-wide ACTIVE policy; with neither, the safe built-in default.
 */
export async function resolveActivePolicy(businessId: string, workflowId?: string | null): Promise<ResolvedPolicy> {
  const workflowPolicy = workflowId
    ? await prisma.aIPolicy.findFirst({ where: { businessId, scope: "WORKFLOW", workflowId, status: "ACTIVE" }, include: { rules: true } })
    : null;
  const businessPolicy = await prisma.aIPolicy.findFirst({
    where: { businessId, scope: "BUSINESS", status: "ACTIVE" },
    include: { rules: true },
  });
  const active = workflowPolicy ?? businessPolicy;
  if (!active) {
    return { policyId: null, version: null, mode: DEFAULT_MODE, document: DEFAULT_POLICY_DOCUMENT, rules: DEFAULT_RULES, isDefault: true };
  }
  return {
    policyId: active.id,
    version: active.version,
    mode: (active.mode as AIMode) ?? DEFAULT_MODE,
    document: policyDocumentSchema.parse(active.document),
    rules: active.rules.map((rule) => ({
      category: rule.category as EvaluableRule["category"],
      action: rule.action,
      toolName: rule.toolName,
      workflowId: rule.workflowId,
      effect: rule.effect as PolicyEffect,
      strategy: rule.strategy as EvaluableRule["strategy"],
      approverUserId: rule.approverUserId,
      minConfidence: rule.minConfidence,
    })),
    isDefault: false,
  };
}

function categoryFor(checkpoint: PolicyCheckpoint): EvaluableRule["category"] {
  return checkpoint === "TOOL_EXECUTION" ? "TOOL" : "APPROVAL";
}

function matchRule(rules: EvaluableRule[], req: PolicyRequest): EvaluableRule | null {
  const wantCategory = categoryFor(req.checkpoint);
  let best: EvaluableRule | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    if (rule.toolName && rule.toolName !== req.toolName) continue;
    if (rule.workflowId && rule.workflowId !== req.workflowId) continue;
    // Category is a hint, not a gate: an APPROVAL rule for "payment" still
    // applies when a payment arrives as a tool call, and a generic
    // "tool_call" rule is the catch-all at the TOOL_EXECUTION checkpoint.
    const exactAction = rule.action === req.action;
    const genericTool = wantCategory === "TOOL" && rule.action === "tool_call";
    if (!exactAction && !genericTool) continue;
    const score = (rule.toolName ? 8 : 0) + (rule.workflowId ? 4 : 0) + (exactAction ? 2 : 0) + (rule.category === wantCategory ? 1 : 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

function quietHoursActive(document: PolicyDocument, timezone: string, now: Date): boolean {
  const quiet = document.business.quietHours;
  if (!quiet) return false;
  const { minute } = zonedParts(now, timezone || "UTC");
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

function outsideBusinessHours(hours: WeeklyHours, timezone: string, now: Date): boolean {
  const { weekday, minute } = zonedParts(now, timezone || "UTC");
  const day = hours[weekday];
  if (!day?.enabled) return true;
  return minute < minutesOfDay(day.opensAt) || minute >= minutesOfDay(day.closesAt);
}

async function detectCrossTenant(req: PolicyRequest): Promise<PolicyReason | null> {
  const checks: Array<Promise<PolicyReason | null>> = [];
  if (req.customerId) {
    checks.push(
      prisma.customer
        .findUnique({ where: { id: req.customerId }, select: { businessId: true } })
        .then((row) => (row && row.businessId !== req.businessId ? { code: "CROSS_TENANT", message: "Referenced customer belongs to another business", stage: "tenant" } : null)),
    );
  }
  if (req.conversationId) {
    checks.push(
      prisma.conversation
        .findUnique({ where: { id: req.conversationId }, select: { businessId: true } })
        .then((row) => (row && row.businessId !== req.businessId ? { code: "CROSS_TENANT", message: "Referenced conversation belongs to another business", stage: "tenant" } : null)),
    );
  }
  if (req.workflowExecutionId) {
    checks.push(
      prisma.workflowExecution
        .findUnique({ where: { id: req.workflowExecutionId }, select: { businessId: true } })
        .then((row) => (row && row.businessId !== req.businessId ? { code: "CROSS_TENANT", message: "Referenced workflow execution belongs to another business", stage: "tenant" } : null)),
    );
  }
  if (req.runId) {
    checks.push(
      prisma.aIConversationRun
        .findUnique({ where: { id: req.runId }, select: { businessId: true } })
        .then((row) => (row && row.businessId !== req.businessId ? { code: "CROSS_TENANT", message: "Referenced AI run belongs to another business", stage: "tenant" } : null)),
    );
  }
  const results = await Promise.all(checks);
  return results.find((r): r is PolicyReason => r !== null) ?? null;
}

async function aiKillSwitchEngaged(businessId: string): Promise<boolean> {
  const [setting, flag] = await Promise.all([
    prisma.platformSetting.findFirst({ where: { key: "ai_enabled" }, select: { value: true } }),
    prisma.featureFlag.findFirst({
      where: { key: "kill_switch.ai", enabled: true, OR: [{ scope: "PLATFORM" }, { scope: "BUSINESS", businessId }] },
      select: { id: true },
    }),
  ]);
  if (setting && setting.value === false) return true;
  return Boolean(flag);
}

/**
 * The authoritative decision. Runs every stage, takes the most restrictive
 * outcome (ALLOW < REQUIRE_APPROVAL < ESCALATE < DENY), records an
 * AIPolicyDecision, and returns the verdict with its reasons.
 */
export async function evaluatePolicy(req: PolicyRequest): Promise<PolicyResult> {
  const now = req.now ?? new Date();
  const reasons: PolicyReason[] = [];
  let effect: PolicyEffect = "ALLOW";
  let requiredApprovalStrategy: string | undefined;
  const bump = (next: PolicyEffect, code: string, message: string, stage: string) => {
    if (SEVERITY[next] > SEVERITY[effect]) effect = next;
    reasons.push({ code, message, stage });
  };

  const policy = await resolveActivePolicy(req.businessId, req.workflowId);
  const doc = policy.document;
  const business = await prisma.business.findUnique({
    where: { id: req.businessId },
    select: { timezone: true, industry: true, workingHours: true },
  });
  const timezone = business?.timezone || "UTC";
  const isOutward = OUTWARD.includes(req.checkpoint);

  // 1. Kill switch
  if (await aiKillSwitchEngaged(req.businessId)) {
    bump("DENY", "AI_KILL_SWITCH", "AI is currently disabled for this business", "killSwitch");
  }

  // 2. Safety — prompt injection on the way in
  if (doc.safety.blockPromptInjection && req.promptText && detectPromptInjection(req.promptText)) {
    bump("DENY", "PROMPT_INJECTION", "Prompt contains injection or jailbreak phrasing", "safety");
  }

  // 2b. Safety — scan generated output on the way out
  if (req.outputText) {
    for (const finding of scanModelOutput(req.outputText)) {
      const enabled =
        finding.code === "PII_DETECTED"
          ? doc.safety.blockPiiInOutput
          : finding.code === "DATA_LEAKAGE"
            ? doc.safety.blockDataLeakage
            : doc.safety.blockUnsafeOutput;
      if (enabled) bump("DENY", finding.code, finding.message, "safety");
    }
  }

  // 3. Cross-tenant protection
  if (doc.safety.enforceTenantIsolation) {
    const leak = await detectCrossTenant(req);
    if (leak) {
      effect = "DENY";
      reasons.push(leak);
    }
  }

  // 4. Business policies (outward checkpoints only)
  if (isOutward) {
    if (req.channel && !doc.business.allowedChannels.includes(req.channel)) {
      bump("DENY", "CHANNEL_NOT_ALLOWED", `Channel "${req.channel}" is not permitted by policy`, "business");
    }
    if (quietHoursActive(doc, timezone, now)) {
      bump("REQUIRE_APPROVAL", "QUIET_HOURS", "The request falls within configured quiet hours", "business");
    }
    if (doc.business.respectBusinessHours && business?.workingHours && outsideBusinessHours(parseWorkingHours(business.workingHours), timezone, now)) {
      bump("REQUIRE_APPROVAL", "OUTSIDE_BUSINESS_HOURS", "The request falls outside business hours", "business");
    }
    const hitTopics = (req.topics ?? []).filter((topic) => doc.business.blockedTopics.includes(topic));
    if (hitTopics.length) {
      bump("DENY", "BLOCKED_TOPIC", `Sensitive topic not permitted: ${hitTopics.join(", ")}`, "business");
    }
    if (business?.industry && doc.business.restrictedIndustries.includes(business.industry)) {
      bump("REQUIRE_APPROVAL", "RESTRICTED_INDUSTRY", `Industry "${business.industry}" requires human approval`, "business");
    }
  }

  // 5. Customer policies
  if (req.customerId && isOutward) {
    const customerReason = await evaluateCustomerPolicies(req, doc);
    for (const reason of customerReason.deny) bump("DENY", reason.code, reason.message, "customer");
    for (const reason of customerReason.review) bump("REQUIRE_APPROVAL", reason.code, reason.message, "customer");
  }

  // 6. Confidence thresholds
  if (typeof req.confidence === "number") {
    if (req.confidence < doc.confidence.escalateBelow) {
      bump("ESCALATE", "LOW_CONFIDENCE_ESCALATE", `Confidence ${req.confidence.toFixed(2)} is below the escalation floor`, "confidence");
    } else {
      if (req.checkpoint === "TOOL_EXECUTION" && req.confidence < doc.confidence.toolMin) {
        bump("REQUIRE_APPROVAL", "LOW_CONFIDENCE_TOOL", `Confidence ${req.confidence.toFixed(2)} is below the tool-execution threshold`, "confidence");
      }
      if (req.checkpoint === "CUSTOMER_RESPONSE" && req.confidence < doc.confidence.respondMin) {
        bump("REQUIRE_APPROVAL", "LOW_CONFIDENCE_RESPOND", `Confidence ${req.confidence.toFixed(2)} is below the respond threshold`, "confidence");
      }
      if (policy.mode === "AUTONOMOUS" && isOutward && req.confidence < doc.confidence.autonomousMin) {
        bump("REQUIRE_APPROVAL", "LOW_CONFIDENCE_AUTONOMOUS", `Confidence ${req.confidence.toFixed(2)} is below the autonomous threshold`, "confidence");
      }
    }
  }

  // 7. Approval / tool rules
  const rule = matchRule(policy.rules, req);
  if (rule) {
    if (rule.minConfidence != null && (req.confidence ?? 1) < rule.minConfidence) {
      bump("REQUIRE_APPROVAL", "RULE_MIN_CONFIDENCE", `Rule for "${req.action}" requires confidence ≥ ${rule.minConfidence}`, "rule");
      requiredApprovalStrategy = rule.strategy;
    }
    if (rule.effect === "DENY") {
      bump("DENY", "RULE_DENY", `Policy rule denies "${req.action}"`, "rule");
    } else if (rule.effect === "REQUIRE_APPROVAL" || rule.effect === "ESCALATE") {
      bump(rule.effect, rule.effect === "ESCALATE" ? "RULE_ESCALATE" : "RULE_REQUIRE_APPROVAL", `Policy rule requires ${rule.effect === "ESCALATE" ? "escalation" : "approval"} for "${req.action}"`, "rule");
      requiredApprovalStrategy = rule.strategy;
    }
  }

  // 8. Mode gate — draft/approval modes never let an outward action through unattended
  if (isOutward && effect !== "DENY") {
    if (policy.mode === "DRAFT") {
      bump("REQUIRE_APPROVAL", "MODE_DRAFT", "Business is in Draft mode: AI proposes, a human sends", "mode");
    } else if (policy.mode === "APPROVAL") {
      bump("REQUIRE_APPROVAL", "MODE_APPROVAL", "Business is in Approval mode: outward actions need sign-off", "mode");
    }
  }

  if (effect === "ALLOW") reasons.push({ code: "ALLOWED", message: "All policy checks passed", stage: "final" });

  let decisionId = "dry-run";
  if (!req.dryRun) {
    const decision = await prisma.aIPolicyDecision.create({
      data: {
        businessId: req.businessId,
        customerId: req.customerId,
        conversationId: req.conversationId,
        workflowExecutionId: req.workflowExecutionId,
        runId: req.runId,
        policyId: policy.policyId,
        policyVersion: policy.version,
        checkpoint: req.checkpoint,
        action: req.action,
        mode: policy.mode,
        outcome: effect,
        reasons: reasons as never,
        confidence: req.confidence,
        requiredApprovalStrategy,
        channel: req.channel,
        correlationId: req.correlationId,
      },
    });
    decisionId = decision.id;
  }

  // LOOP 3B-4: operational metrics for approval / escalation / denial rates.
  const settled = effect as string;
  if (!req.dryRun) {
    if (settled === "REQUIRE_APPROVAL") emitAIEvent({ businessId: req.businessId, metric: "approvals" });
    else if (settled === "ESCALATE") emitAIEvent({ businessId: req.businessId, metric: "escalations" });
    else if (settled === "DENY") emitAIEvent({ businessId: req.businessId, metric: "policy_denials" });
  }

  return {
    effect,
    mode: policy.mode,
    allowed: effect === "ALLOW",
    reasons,
    requiredApprovalStrategy,
    decisionId,
    policyId: policy.policyId ?? undefined,
    policyVersion: policy.version ?? undefined,
    isDefaultPolicy: policy.isDefault,
  };
}

async function evaluateCustomerPolicies(req: PolicyRequest, doc: PolicyDocument) {
  const deny: PolicyReason[] = [];
  const review: PolicyReason[] = [];
  const channel = (req.channel ?? "sms").toLowerCase();
  const [customer, preference] = await Promise.all([
    prisma.customer.findFirst({ where: { id: req.customerId, businessId: req.businessId }, select: { id: true, phoneE164: true } }),
    prisma.customerCommunicationPreference.findUnique({
      where: { businessId_customerId: { businessId: req.businessId, customerId: req.customerId! } },
    }),
  ]);
  if (!customer) return { deny, review };

  if (doc.customer.respectSuppressions) {
    const suppression = await prisma.suppression.findFirst({
      where: {
        businessId: req.businessId,
        active: true,
        channel: { in: [channel.toUpperCase(), "ALL"] },
        OR: [{ customerId: customer.id }, ...(customer.phoneE164 ? [{ address: customer.phoneE164 }] : [])],
      },
      select: { id: true },
    });
    if (suppression) deny.push({ code: "CUSTOMER_SUPPRESSED", message: "Customer is on the suppression list for this channel", stage: "customer" });
  }

  if (doc.customer.respectOptOut && customer.phoneE164) {
    const optOut = await prisma.customerOptOut.findFirst({
      where: { businessId: req.businessId, phone: customer.phoneE164, channel: { in: [channel === "sms" ? "SMS" : "WHATSAPP", "ALL"] } },
      select: { id: true },
    });
    if (optOut) deny.push({ code: "CUSTOMER_OPTED_OUT", message: "Customer has opted out of this channel", stage: "customer" });
  }

  if (preference) {
    const purpose = (req.purpose ?? "SERVICE").toUpperCase();
    if (doc.customer.requireConsentForMarketing && purpose === "MARKETING" && !preference.marketingConsent) {
      deny.push({ code: "NO_MARKETING_CONSENT", message: "Customer has not granted marketing consent", stage: "customer" });
    }
    if (purpose === "SERVICE" && preference.serviceConsent === false) {
      deny.push({ code: "NO_SERVICE_CONSENT", message: "Customer has withdrawn service-message consent", stage: "customer" });
    }
    if (doc.customer.respectPreferredChannel && Array.isArray(preference.preferredChannels) && preference.preferredChannels.length > 0) {
      const preferred = (preference.preferredChannels as unknown[]).map((value) => String(value).toLowerCase());
      if (!preferred.includes(channel)) {
        review.push({ code: "NOT_PREFERRED_CHANNEL", message: `Customer prefers ${preferred.join(", ")}, not ${channel}`, stage: "customer" });
      }
    }
  }

  return { deny, review };
}

/**
 * Enforcement wrapper used at runtime checkpoints. Throws on DENY; otherwise
 * returns the result so the caller can route REQUIRE_APPROVAL / ESCALATE.
 */
export async function assertPolicyAllows(req: PolicyRequest): Promise<PolicyResult> {
  const result = await evaluatePolicy(req);
  if (result.effect === "DENY") {
    throw ApiError.forbidden(`Policy denied this action: ${result.reasons.map((reason) => reason.message).join("; ")}`, {
      code: "POLICY_DENIED",
      decisionId: result.decisionId,
      reasons: result.reasons,
    });
  }
  return result;
}

/** Stable hash of a policy document — stored on AIPolicy for change detection. */
export function policyDocumentChecksum(document: unknown): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}
