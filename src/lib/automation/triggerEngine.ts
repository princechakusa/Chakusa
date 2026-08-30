import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { registerSubscriber, type DomainEvent } from "./domainEventBus.js";
import { startWorkflowExecution } from "./workflowRuntime.js";
import type { WorkflowDefinition } from "./workflowContracts.js";
import { isTimeTriggered, nextWorkflowTriggerAt, workflowLocalDay } from "./workflowScheduling.js";

const EVENT_TRIGGER_MAP: Record<string, string> = { CustomerCreated: "CUSTOMER_CREATED", CustomerUpdated: "CUSTOMER_UPDATED", LeadCreated: "LEAD_CREATED", LeadUpdated: "LEAD_UPDATED", AppointmentBooked: "APPOINTMENT_BOOKED", AppointmentUpdated: "APPOINTMENT_UPDATED", AppointmentCancelled: "APPOINTMENT_CANCELLED", AppointmentCompleted: "APPOINTMENT_COMPLETED", PaymentReceived: "PAYMENT_RECEIVED", PaymentRefunded: "PAYMENT_REFUNDED", ReviewSubmitted: "REVIEW_SUBMITTED" };

async function triggerPublishedWorkflows(event: DomainEvent) {
  const triggerType = EVENT_TRIGGER_MAP[event.type]; if (!triggerType) return;
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {}; const lineage = Array.isArray(metadata.automationLineage) ? metadata.automationLineage.map(String).slice(-50) : [];
  const workflows = await prisma.workflow.findMany({ where: { businessId: event.businessId, status: "PUBLISHED" }, include: { versions: { where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 } } });
  for (const workflow of workflows) {
    const version = workflow.versions[0]; if (!version) continue;
    const definition = version.definition as unknown as WorkflowDefinition; if (definition.trigger?.type !== triggerType || lineage.includes(workflow.id)) continue;
    await startWorkflowExecution({ workflowId: workflow.id, version: version.version, businessId: event.businessId, triggerEventId: event.id, idempotencyKey: `${workflow.id}:${version.version}:${event.id}`, state: { event: event.payload, eventType: event.type, eventId: event.id, correlationId: event.correlationId ?? event.id, automationLineage: [...lineage, workflow.id] } as Prisma.InputJsonValue });
  }
}

let registered = false;
export async function registerWorkflowTriggerSubscribers() {
  if (registered) return;
  for (const eventType of Object.keys(EVENT_TRIGGER_MAP)) await registerSubscriber({ name: `workflow-trigger-v1:${eventType}`, eventType, version: 1, handler: triggerPublishedWorkflows });
  registered = true;
}

export async function initializeWorkflowSchedules() {
  for (;;) {
    const workflows = await prisma.workflow.findMany({ where: { status: "PUBLISHED", scheduleEnabled: null }, include: { versions: { where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 } }, take: 250 });
    if (!workflows.length) return;
    for (const workflow of workflows) {
      const version = workflow.versions[0];
      if (!version) { await prisma.workflow.update({ where: { id: workflow.id }, data: { scheduleEnabled: false } }); continue; }
      const definition = version.definition as unknown as WorkflowDefinition;
      const enabled = isTimeTriggered(definition);
      const business = enabled ? await prisma.business.findUnique({ where: { id: workflow.businessId }, select: { timezone: true } }) : null;
      await prisma.workflow.update({ where: { id: workflow.id }, data: { scheduleEnabled: enabled, nextTriggerAt: enabled ? nextWorkflowTriggerAt(definition, String(definition.trigger.config?.timezone ?? business?.timezone ?? "UTC")) : null } });
    }
  }
}

export async function scheduleTimeTriggers(now = new Date(), batchSize = 100) {
  const owner = randomUUID(); const leaseUntil = new Date(now.getTime() + 60_000);
  const claimed = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`WITH candidates AS (SELECT id FROM workflows WHERE status='PUBLISHED' AND schedule_enabled=true AND next_trigger_at <= ${now} AND (schedule_lease_expires_at IS NULL OR schedule_lease_expires_at < ${now}) ORDER BY next_trigger_at,id FOR UPDATE SKIP LOCKED LIMIT ${batchSize}) UPDATE workflows w SET schedule_lease_owner=${owner},schedule_lease_expires_at=${leaseUntil} FROM candidates c WHERE w.id=c.id RETURNING w.id`));
  const workflows = await prisma.workflow.findMany({ where: { id: { in: claimed.map((row) => row.id) }, scheduleLeaseOwner: owner }, include: { versions: { where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 } } });
  let scheduled = 0; let firstError: unknown;
  for (const workflow of workflows) {
    const version = workflow.versions[0]; if (!version) { await prisma.workflow.updateMany({ where: { id: workflow.id, scheduleLeaseOwner: owner }, data: { scheduleEnabled: false, nextTriggerAt: null, scheduleLeaseOwner: null, scheduleLeaseExpiresAt: null } }); continue; }
    const definition = version.definition as unknown as WorkflowDefinition;
    if (!isTimeTriggered(definition)) { await prisma.workflow.updateMany({ where: { id: workflow.id, scheduleLeaseOwner: owner }, data: { scheduleEnabled: false, nextTriggerAt: null, scheduleLeaseOwner: null, scheduleLeaseExpiresAt: null } }); continue; }
    const business = await prisma.business.findUnique({ where: { id: workflow.businessId }, select: { timezone: true } }); const timezone = String(definition.trigger.config?.timezone ?? business?.timezone ?? "UTC");
    let dueAt = workflow.nextTriggerAt ?? now; const maxCatchUp = Math.min(366, Math.max(1, Number(definition.trigger.config?.maxMissedOccurrences ?? 100)));
    try {
      let caughtUp = 0;
      while (dueAt <= now && caughtUp < maxCatchUp) {
        const local = workflowLocalDay(dueAt, timezone);
        if (definition.trigger.type === "SCHEDULED") { await startWorkflowExecution({ workflowId: workflow.id, version: version.version, businessId: workflow.businessId, idempotencyKey: `${workflow.id}:${version.version}:SCHEDULED:${local.key}`, state: { scheduledAt: dueAt.toISOString(), timezone, missedSchedule: dueAt < now, automationLineage: [workflow.id] } as Prisma.InputJsonValue }); scheduled += 1; }
        else { const dateColumn = definition.trigger.type === "BIRTHDAY" ? Prisma.raw('"birthday"') : Prisma.raw('"anniversary"'); const customers = await prisma.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`SELECT id,name FROM customers WHERE business_id=${workflow.businessId} AND ${dateColumn} IS NOT NULL AND EXTRACT(MONTH FROM ${dateColumn})=${local.month} AND EXTRACT(DAY FROM ${dateColumn})=${local.day}`); for (const customer of customers) { await startWorkflowExecution({ workflowId: workflow.id, version: version.version, businessId: workflow.businessId, idempotencyKey: `${workflow.id}:${version.version}:${definition.trigger.type}:${customer.id}:${local.key}`, state: { customer: { id: customer.id, name: customer.name }, scheduledAt: dueAt.toISOString(), timezone, missedSchedule: dueAt < now, automationLineage: [workflow.id] } as Prisma.InputJsonValue }); scheduled += 1; } }
        dueAt = nextWorkflowTriggerAt(definition, timezone, dueAt)!; caughtUp += 1;
      }
      // A bounded catch-up prevents a single tenant monopolising a poll. If the
      // cap is reached the row remains immediately due for the next fair batch.
      await prisma.workflow.updateMany({ where: { id: workflow.id, scheduleLeaseOwner: owner }, data: { nextTriggerAt: dueAt, scheduleLeaseOwner: null, scheduleLeaseExpiresAt: null } });
    } catch (error) { await prisma.workflow.updateMany({ where: { id: workflow.id, scheduleLeaseOwner: owner }, data: { nextTriggerAt: dueAt, scheduleLeaseOwner: null, scheduleLeaseExpiresAt: new Date(Date.now() + 300_000) } }); firstError ??= error; }
  }
  if (firstError) throw firstError;
  return scheduled;
}
