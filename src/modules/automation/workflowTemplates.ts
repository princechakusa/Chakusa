import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { WorkflowDefinition } from "../../lib/automation/workflowContracts.js";
import { validateWorkflow } from "../../lib/automation/workflowValidation.js";
import { ApiError } from "../../lib/errors.js";

const task = (trigger: string, title: string, delay?: { amount: number; unit: "hours" | "days" | "business_days" }): WorkflowDefinition => ({ trigger: { type: trigger }, startNodeId: delay ? "wait" : "task", nodes: [...(delay ? [{ id: "wait", type: "delay" as const, config: delay, next: ["task"] }] : []), { id: "task", type: "action", config: { action: "CREATE_TASK", title }, next: [] }], settings: { timeoutSeconds: 7_776_000, maxRetries: 5 } });
export const TEMPLATE_DEFINITIONS = [
  ["MISSED_CALL_RECOVERY","Missed Call Recovery",task("LEAD_CREATED","Follow up with missed-call lead",{ amount: 5, unit: "hours" })],
  ["APPOINTMENT_REMINDER","Appointment Reminder",task("APPOINTMENT_BOOKED","Review upcoming appointment",{ amount: 1, unit: "days" })],
  ["REVIEW_REQUEST","Review Request",task("APPOINTMENT_COMPLETED","Request a customer review",{ amount: 1, unit: "days" })],
  ["PRIVATE_FEEDBACK","Private Feedback",task("REVIEW_SUBMITTED","Review private customer feedback")],
  ["CUSTOMER_COMEBACK","Customer Comeback",task("CUSTOMER_UPDATED","Plan customer comeback",{ amount: 30, unit: "business_days" })],
  ["PAYMENT_REMINDER","Payment Reminder",task("APPOINTMENT_COMPLETED","Follow up on outstanding payment",{ amount: 1, unit: "business_days" })],
  ["BIRTHDAY","Birthday",task("BIRTHDAY","Send birthday outreach")],
  ["WELCOME_CUSTOMER","Welcome Customer",task("CUSTOMER_CREATED","Welcome new customer")],
  ["QUOTE_FOLLOW_UP","Quote Follow-up",task("LEAD_CREATED","Follow up on quote",{ amount: 2, unit: "business_days" })],
  ["CANCELLATION_RECOVERY","Cancellation Recovery",task("APPOINTMENT_CANCELLED","Recover cancelled appointment")],
  ["REFERRAL_CAMPAIGN","Referral Campaign",task("MANUAL","Run referral campaign")],
  ["RETENTION_CAMPAIGN","Retention Campaign",task("SCHEDULED","Review retention audience")],
  ["SEASONAL_CAMPAIGN","Seasonal Campaign",task("SCHEDULED","Launch seasonal campaign")],
  ["VIP_CUSTOMER","VIP Customer",task("CUSTOMER_UPDATED","Review VIP customer care")],
] as const;

export async function ensureWorkflowTemplates() { for (const [key, name, definition] of TEMPLATE_DEFINITIONS) { const checksum = crypto.createHash("sha256").update(JSON.stringify(definition)).digest("hex"); await prisma.workflowTemplate.upsert({ where: { key_version: { key, version: 1 } }, create: { key, version: 1, name, definition: definition as unknown as Prisma.InputJsonValue, checksum }, update: { name, definition: definition as unknown as Prisma.InputJsonValue, checksum } }); } }
export async function listWorkflowTemplates() { await ensureWorkflowTemplates(); return prisma.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ key: "asc" }, { version: "desc" }] }); }
export async function listAllWorkflowTemplates() { await ensureWorkflowTemplates(); return prisma.workflowTemplate.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] }); }
export async function createWorkflowTemplateVersion(input: { key: string; name: string; description?: string; definition: WorkflowDefinition }) { const validation = validateWorkflow(input.definition); if (!validation.valid) throw ApiError.badRequest(`Invalid workflow template: ${validation.errors.join("; ")}`); return prisma.$transaction(async (tx) => { const latest = await tx.workflowTemplate.findFirst({ where: { key: input.key }, orderBy: { version: "desc" }, select: { version: true } }); const version = (latest?.version ?? 0) + 1; const digest = crypto.createHash("sha256").update(JSON.stringify(input.definition)).digest("hex"); return tx.workflowTemplate.create({ data: { key: input.key, version, name: input.name, description: input.description, definition: input.definition as unknown as Prisma.InputJsonValue, checksum: digest } }); }, { isolationLevel: "Serializable" }); }
export function setWorkflowTemplateActive(id: string, active: boolean) { return prisma.workflowTemplate.update({ where: { id }, data: { active } }); }
