import { randomUUID } from "node:crypto";
import { Prisma, type WorkflowExecutionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { actionIdempotencyKey, getAction, PermanentActionError, type ActionResult } from "./actionRegistry.js";
import { evaluateCondition, isWithinBusinessHours, type Condition } from "./conditionEngine.js";
import { delayUntil, type DelaySpec } from "./delayEngine.js";
import type { WorkflowDefinition, WorkflowNode } from "./workflowContracts.js";
import { validateWorkflow } from "./workflowValidation.js";
import { getAutomationFoundationStatus } from "../../modules/automation/automationFoundation.js";

const LEASE_MS = 60_000; const MAX_ATTEMPTS = 20;
const ACTION_HEARTBEAT_MS = Math.max(1_000, Math.floor(LEASE_MS / 3));
export async function startWorkflowExecution(input: { workflowId: string; version: number; businessId: string; idempotencyKey: string; triggerEventId?: string; state?: Prisma.InputJsonValue }) {
  const version = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId: input.workflowId, version: input.version } }); const definition = version.definition as unknown as WorkflowDefinition; const validation = validateWorkflow(definition); if (!validation.valid) throw new Error(`Invalid workflow version: ${validation.errors.join("; ")}`);
  const first = definition.startNodeId ?? definition.nodes[0]?.id ?? null; const timeoutSeconds = Number(definition.settings?.timeoutSeconds ?? 31_536_000);
  const execution = await prisma.workflowExecution.upsert({ where: { idempotencyKey: input.idempotencyKey }, create: { workflowId: input.workflowId, version: input.version, businessId: input.businessId, triggerEventId: input.triggerEventId, idempotencyKey: input.idempotencyKey, state: input.state ?? {}, currentNodeId: first, scheduledFor: new Date(), nextAttemptAt: new Date(), timeoutAt: new Date(Date.now() + timeoutSeconds * 1_000) }, update: {} });
  await prisma.workflowExecutionEvent.upsert({ where: { id: `started:${execution.id}` }, create: { id: `started:${execution.id}`, executionId: execution.id, businessId: execution.businessId, type: "STARTED" }, update: {} }); return execution;
}

export async function claimWorkflowExecutions(batchSize = 25) { const owner = randomUUID(); const now = new Date(); const leaseUntil = new Date(now.getTime() + LEASE_MS); const rows = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH candidates AS (SELECT id FROM workflow_executions WHERE status IN ('PENDING','FAILED') AND completed_at IS NULL AND retry_count < ${MAX_ATTEMPTS} AND next_attempt_at <= ${now} AND (lease_expires_at IS NULL OR lease_expires_at < ${now}) ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT ${batchSize}) UPDATE workflow_executions w SET status='RUNNING',lease_owner=${owner},lease_expires_at=${leaseUntil},started_at=COALESCE(started_at,${now}),attempts=w.attempts+1 FROM candidates c WHERE w.id=c.id RETURNING w.id`)); return { owner, ids: rows.map((row) => row.id) }; }

function nextNode(definition: WorkflowDefinition, node: WorkflowNode, branch?: boolean) { const id = branch === undefined ? node.next?.[0] : node.next?.[branch ? 0 : 1]; return id ? definition.nodes.find((item) => item.id === id) : undefined; }
export async function executeClaimedWorkflow(executionId: string, owner: string) {
  const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, leaseOwner: owner, status: "RUNNING" } }); if (!execution) return null;
  const foundation = await getAutomationFoundationStatus(execution.businessId); if (!foundation.killSwitches.automation || foundation.maintenance) { await prisma.workflowExecution.update({ where: { id: execution.id }, data: { status: "PENDING", nextAttemptAt: new Date(Date.now()+60_000), leaseOwner: null, leaseExpiresAt: null, lastError: "automation_disabled" } }); return; }
  if (execution.timeoutAt && execution.timeoutAt <= new Date()) return finish(execution.id, owner, "FAILED", "workflow_timeout");
  const version = await prisma.workflowVersion.findFirstOrThrow({ where: { workflowId: execution.workflowId, version: execution.version } }); const definition = version.definition as unknown as WorkflowDefinition; const validation = validateWorkflow(definition); if (!validation.valid) return finish(execution.id, owner, "FAILED", `runtime_validation:${validation.errors.join(";")}`);
  let node = definition.nodes.find((item) => item.id === execution.currentNodeId); let state = await hydrateState(execution.businessId, execution.state as Record<string, unknown>); const started = Date.now(); const maxRetries = Math.min(definition.settings?.maxRetries ?? 5, MAX_ATTEMPTS);
  try {
    while (node) {
      if (execution.timeoutAt && execution.timeoutAt <= new Date()) return finish(execution.id, owner, "FAILED", "workflow_timeout");
      const heartbeat = await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { currentNodeId: node.id, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
      if (!heartbeat.count) return null;
      if (node.type === "condition" || node.type === "branch") node = nextNode(definition, node, evaluateCondition(node.config.condition as Condition, state));
      else if (node.type === "delay") { const business = ((state.context as Record<string, unknown> | undefined)?.business ?? {}) as Record<string, unknown>; const until = delayUntil(new Date(), { ...node.config, timezone: node.config.timezone ?? business.timezone, workingHours: node.config.workingHours ?? business.workingHours } as unknown as DelaySpec); const following = nextNode(definition, node); const delayed = await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "PENDING", currentNodeId: following?.id ?? null, nextAttemptAt: until, scheduledFor: until, leaseOwner: null, leaseExpiresAt: null } }); if (delayed.count) await log(execution.id, execution.businessId, "DELAYED", node.id, Date.now() - started); return; }
      else {
        const actionName = String(node.config.action); const provider = typeof node.config.provider === "string" ? node.config.provider : undefined;
        const providerUnavailable = (provider ? foundation.providerKillSwitches[provider] === true : false) || (actionName === "INVOKE_AI" && (!foundation.killSwitches.providers || !foundation.killSwitches.ai)) || (actionName === "INVOKE_MESSAGING" && (!foundation.killSwitches.providers || !foundation.killSwitches.messaging));
        if (providerUnavailable) { await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "PENDING", nextAttemptAt: new Date(Date.now() + 60_000), leaseOwner: null, leaseExpiresAt: null, lastError: `${provider ?? actionName.toLowerCase()}_disabled` } }); return; }
        const action = getAction(actionName); if (!action) throw new Error(`Unknown action: ${actionName}`); const actionTimeoutAt = node.config.timeoutSeconds === undefined ? execution.timeoutAt : new Date(Math.min(execution.timeoutAt?.getTime() ?? Number.MAX_SAFE_INTEGER, Date.now() + Number(node.config.timeoutSeconds) * 1_000)); const result = await executeActionExactlyOnce({ executionId: execution.id, businessId: execution.businessId, nodeId: node.id, actionName, owner, timeoutAt: actionTimeoutAt, input: state, config: node.config, action }) as ActionResult; state = { ...state, [node.id]: result?.output ?? result }; const following = nextNode(definition, node); const progressed = await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { state: state as Prisma.InputJsonValue, currentNodeId: following?.id ?? null, leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }); if (!progressed.count) return null; await log(execution.id, execution.businessId, "ACTION_COMPLETED", node.id); if (result?.directive === "PAUSE") { await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "PAUSED", leaseOwner: null, leaseExpiresAt: null } }); return; } if (result?.directive === "COMPLETE") node = undefined; else node = following;
      }
    }
    const completed = await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "COMPLETED", state: state as Prisma.InputJsonValue, completedAt: new Date(), currentNodeId: null, leaseOwner: null, leaseExpiresAt: null, lastError: null } }); if (completed.count) await log(execution.id, execution.businessId, "COMPLETED", undefined, Date.now() - started);
  } catch (error) { const message = error instanceof Error ? error.message.slice(0, 2_000) : "workflow_failed"; const nextRetry = execution.retryCount + 1; const dead = error instanceof PermanentActionError || nextRetry >= maxRetries; const failed = await prisma.workflowExecution.updateMany({ where: { id: execution.id, leaseOwner: owner, status: "RUNNING" }, data: { status: "FAILED", state: state as Prisma.InputJsonValue, retryCount: nextRetry, lastError: message, nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 5_000 * 2 ** nextRetry)), leaseOwner: null, leaseExpiresAt: null, ...(dead ? { completedAt: new Date() } : {}) } }); if (failed.count) await log(execution.id, execution.businessId, dead ? "FAILED_FINAL" : "RETRY_SCHEDULED", node?.id, Date.now() - started, nextRetry); }
}

type RuntimeAction = NonNullable<ReturnType<typeof getAction>>;
async function executeActionExactlyOnce(input: { executionId: string; businessId: string; nodeId: string; actionName: string; owner: string; timeoutAt: Date | null; input: unknown; config: Record<string, unknown>; action: RuntimeAction }) {
  const idempotencyKey = actionIdempotencyKey(input.executionId, input.nodeId);
  const attempt = await prisma.workflowActionAttempt.upsert({
    where: { executionId_nodeId: { executionId: input.executionId, nodeId: input.nodeId } },
    create: { executionId: input.executionId, businessId: input.businessId, nodeId: input.nodeId, actionName: input.actionName, idempotencyKey },
    update: {},
  });
  if (attempt.actionName !== input.actionName || attempt.idempotencyKey !== idempotencyKey) throw new Error("action_attempt_definition_mismatch");
  if (attempt.status === "SUCCEEDED") return attempt.output === null ? undefined : attempt.output;
  const owned = await prisma.workflowExecution.count({ where: { id: input.executionId, leaseOwner: input.owner, status: "RUNNING" } });
  if (!owned) throw new Error("workflow_lease_lost");
  await prisma.workflowActionAttempt.update({ where: { id: attempt.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), lastError: null } });

  const controller = new AbortController();
  let heartbeatRunning = false;
  const heartbeat = async () => {
    if (heartbeatRunning || controller.signal.aborted) return;
    heartbeatRunning = true;
    try {
      const renewed = await prisma.workflowExecution.updateMany({ where: { id: input.executionId, leaseOwner: input.owner, status: "RUNNING" }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
      if (!renewed.count) controller.abort(new Error("workflow_cancelled_or_lease_lost"));
    } catch (error) { controller.abort(error); }
    finally { heartbeatRunning = false; }
  };
  const heartbeatTimer = setInterval(() => { void heartbeat(); }, ACTION_HEARTBEAT_MS);
  heartbeatTimer.unref?.();
  const cancellationTimer = setInterval(() => { void prisma.workflowExecution.count({ where: { id: input.executionId, leaseOwner: input.owner, status: "RUNNING" } }).then((count) => { if (!count) controller.abort(new Error("workflow_cancelled_or_lease_lost")); }, (error) => controller.abort(error)); }, 2_000);
  cancellationTimer.unref?.();
  const remaining = input.timeoutAt ? input.timeoutAt.getTime() - Date.now() : undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleTimeoutCheck = () => {
    if (!input.timeoutAt || controller.signal.aborted) return;
    const delay = input.timeoutAt.getTime() - Date.now();
    if (delay <= 0) { controller.abort(new Error("workflow_timeout")); return; }
    // Node timers use signed 32-bit delays. Chunk distant workflow deadlines
    // instead of overflowing them into an immediate timeout.
    timeoutTimer = setTimeout(scheduleTimeoutCheck, Math.min(delay, 2_147_483_647));
    timeoutTimer.unref?.();
  };
  scheduleTimeoutCheck();
  try {
    if (remaining !== undefined && remaining <= 0) controller.abort(new Error("workflow_timeout"));
    controller.signal.throwIfAborted();
    const result = await input.action({ businessId: input.businessId, executionId: input.executionId, nodeId: input.nodeId, input: input.input, idempotencyKey, signal: controller.signal }, input.config);
    controller.signal.throwIfAborted();
    const serialized = result === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
    await prisma.workflowActionAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", output: serialized, completedAt: new Date(), lastError: null } });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "action_failed";
    await prisma.workflowActionAttempt.updateMany({ where: { id: attempt.id, status: "PROCESSING" }, data: { status: "FAILED", lastError: message } });
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
    clearInterval(cancellationTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
}

async function finish(id: string, owner: string, status: WorkflowExecutionStatus, error?: string) { const row = await prisma.workflowExecution.updateMany({ where: { id, leaseOwner: owner }, data: { status, completedAt: new Date(), lastError: error, leaseOwner: null, leaseExpiresAt: null } }); return row.count; }
function log(executionId: string, businessId: string, type: string, nodeId?: string, durationMs?: number, retryCount = 0) { return prisma.workflowExecutionEvent.create({ data: { executionId, businessId, type, nodeId, durationMs, retryCount } }); }
async function hydrateState(businessId: string, state: Record<string, unknown>) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { timezone: true, workingHours: true, paymentRemindersEnabled: true, subscription: { select: { plan: true, status: true } } } });
  const event = state.event && typeof state.event === "object" ? state.event as Record<string, unknown> : {}; const eventType = String(state.eventType ?? ""); const aggregateId = String(event.id ?? "");
  const lead = eventType.startsWith("Lead") && aggregateId ? await prisma.lead.findFirst({ where: { id: aggregateId, businessId }, select: { id: true, customerId: true, source: true, serviceRequested: true, urgency: true, status: true, estimatedValue: true, paymentStatus: true, paidAmount: true, contactedAt: true, bookedAt: true, wonAt: true, lostAt: true, createdAt: true } }) : null;
  const appointment = eventType.startsWith("Appointment") && aggregateId ? await prisma.appointment.findFirst({ where: { id: aggregateId, businessId }, select: { id: true, customerId: true, assignedMemberId: true, serviceName: true, startsAt: true, endsAt: true, status: true, price: true, paidAmount: true, paymentStatus: true } }) : null;
  const payment = eventType.startsWith("Payment") && aggregateId ? await prisma.appointmentPaymentTransaction.findFirst({ where: { id: aggregateId, businessId }, select: { id: true, appointmentId: true, kind: true, status: true, amount: true, refundedAmount: true, currency: true, paidAt: true, refundedAt: true } }) : null;
  const review = eventType === "ReviewSubmitted" && aggregateId ? await prisma.reviewRequest.findFirst({ where: { id: aggregateId, businessId }, select: { id: true, customerId: true, serviceName: true, status: true, sentAt: true, updatedAt: true } }) : null;
  const customerId = String(event.customerId ?? lead?.customerId ?? appointment?.customerId ?? review?.customerId ?? (eventType.startsWith("Customer") ? aggregateId : ""));
  const customer = customerId ? await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true, name: true, email: true, phoneE164: true, birthday: true, anniversary: true, customFields: true, createdAt: true, updatedAt: true } }) : null;
  const tags = customer ? await prisma.customerTagAssignment.findMany({ where: { customerId: customer.id, customer: { businessId } }, select: { tag: { select: { name: true } } } }) : [];
  const workingHours = business.workingHours && typeof business.workingHours === "object" && !Array.isArray(business.workingHours) ? business.workingHours as Record<string, { start: string; end: string } | null> : {};
  const serialize = <T extends Record<string, unknown> | null>(value: T) => value ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item && typeof item === "object" && "toNumber" in item ? (item as { toNumber(): number }).toNumber() : item])) : null;
  return { ...state, event, customer: customer ? { ...customer, tags: tags.map((item) => item.tag.name) } : null, lead: serialize(lead), appointment: serialize(appointment), payment: serialize(payment), review, context: { business: { timezone: business.timezone, workingHours, paymentRemindersEnabled: business.paymentRemindersEnabled }, subscription: business.subscription, businessHours: isWithinBusinessHours(new Date(), business.timezone || "UTC", workingHours), delayExpired: true } };
}
export function pauseWorkflowExecution(businessId: string, id: string) { return prisma.$transaction(async (tx) => { const result = await tx.workflowExecution.updateMany({ where: { id, businessId, status: { in: ["PENDING","RUNNING","FAILED"] } }, data: { status: "PAUSED", leaseOwner: null, leaseExpiresAt: null } }); if (result.count) await tx.workflowExecutionEvent.create({ data: { executionId: id, businessId, type: "PAUSED" } }); return result; }); }
export function resumeWorkflowExecution(businessId: string, id: string) { return prisma.$transaction(async (tx) => { const result = await tx.workflowExecution.updateMany({ where: { id, businessId, status: "PAUSED" }, data: { status: "PENDING", nextAttemptAt: new Date(), scheduledFor: new Date(), lastError: null } }); if (result.count) await tx.workflowExecutionEvent.create({ data: { executionId: id, businessId, type: "RESUMED" } }); return result; }); }
export function cancelWorkflowExecution(businessId: string, id: string, reason: string) { return prisma.$transaction(async (tx) => { const result = await tx.workflowExecution.updateMany({ where: { id, businessId, status: { notIn: ["COMPLETED","CANCELLED"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), completedAt: new Date(), cancellationReason: reason, leaseOwner: null, leaseExpiresAt: null } }); if (result.count) await tx.workflowExecutionEvent.create({ data: { executionId: id, businessId, type: "CANCELLED", metadata: { reason } } }); return result; }); }
export function recoverExpiredWorkflowLeases(now = new Date()) { return prisma.$transaction(async (tx) => { const terminal = await tx.workflowExecution.updateMany({ where: { status: "RUNNING", leaseExpiresAt: { lt: now }, retryCount: { gte: MAX_ATTEMPTS - 1 } }, data: { status: "FAILED", retryCount: { increment: 1 }, completedAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: "runtime_lease_expired_final" } }); const retryable = await tx.workflowExecution.updateMany({ where: { status: "RUNNING", leaseExpiresAt: { lt: now }, retryCount: { lt: MAX_ATTEMPTS - 1 } }, data: { status: "FAILED", retryCount: { increment: 1 }, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, lastError: "runtime_lease_expired" } }); return { count: terminal.count + retryable.count }; }); }
