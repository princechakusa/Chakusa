import { z } from "zod";
import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";
import { calculateAvailability } from "../../../modules/availability/availability.service.js";
import { createAppointment, transitionAppointment, updateAppointment } from "../../../modules/appointments/appointments.service.js";
import { deriveBusinessKnowledge } from "../memory/knowledgeSources.js";
import { retrieveMemory } from "../memory/retrievalEngine.js";
import { addPendingQuestion } from "../memory/memoryStore.js";

// LOOP 4 — AI Receptionist tools. These are the *only* actions the Customer
// Agent can take, and every one runs through the existing Tool Broker
// (executeAITool) so the Policy Engine's TOOL_EXECUTION checkpoint, the
// idempotency guard and the invocation ledger all apply unchanged. Each
// handler is a thin call into an existing service — no new booking,
// availability or messaging logic is introduced here.

// AI-initiated bookings are attributed to the business owner — the actor id
// must be a real user (ActivityEvent.actorId is FK'd to users), and the
// owner is the accountable party for anything the agent does on the
// business's behalf.
async function aiActorId(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true } });
  if (!business) throw ApiError.notFound("Business not found");
  return business.ownerId;
}

export interface AgentToolContext {
  businessId: string;
  runId: string;
  conversationId: string;
  customerId: string | null;
}

export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  /** Whether this tool changes external state (books/cancels) — the model still asks, the policy still decides. */
  mutating: boolean;
  run(ctx: AgentToolContext, args: unknown): Promise<{ output: unknown }>;
}

const isoDateTime = z.string().datetime({ offset: true });

const tools: Record<string, AgentTool> = {
  check_availability: {
    name: "check_availability",
    description: "List open appointment slots for a service between two timestamps.",
    mutating: false,
    schema: z.object({ serviceOfferingId: z.string().uuid(), from: isoDateTime, to: isoDateTime, memberId: z.string().uuid().optional() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { serviceOfferingId: string; from: string; to: string; memberId?: string };
      const slots = await calculateAvailability(ctx.businessId, input);
      return { output: { slots: slots.slice(0, 12) } };
    },
  },

  book_appointment: {
    name: "book_appointment",
    description: "Book an appointment for the customer at a specific time.",
    mutating: true,
    schema: z.object({
      serviceOfferingId: z.string().uuid(),
      assignedMemberId: z.string().uuid().optional(),
      startsAt: isoDateTime,
      endsAt: isoDateTime,
      customerId: z.string().uuid().optional(),
    }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { serviceOfferingId: string; assignedMemberId?: string; startsAt: string; endsAt: string; customerId?: string };
      const customerId = input.customerId ?? ctx.customerId;
      if (!customerId) throw ApiError.badRequest("book_appointment requires a customer");
      const appointment = await createAppointment(ctx.businessId, await aiActorId(ctx.businessId), {
        customerId,
        serviceOfferingId: input.serviceOfferingId,
        assignedMemberId: input.assignedMemberId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      } as never);
      return { output: { appointmentId: appointment.id, status: appointment.status, startsAt: appointment.startsAt, serviceName: appointment.serviceName } };
    },
  },

  reschedule_appointment: {
    name: "reschedule_appointment",
    description: "Move an existing appointment to a new time.",
    mutating: true,
    schema: z.object({ appointmentId: z.string().uuid(), startsAt: isoDateTime, endsAt: isoDateTime }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { appointmentId: string; startsAt: string; endsAt: string };
      await assertAppointmentOwned(ctx, input.appointmentId);
      const appointment = await updateAppointment(ctx.businessId, await aiActorId(ctx.businessId), input.appointmentId, { startsAt: input.startsAt, endsAt: input.endsAt } as never);
      return { output: { appointmentId: appointment.id, startsAt: appointment.startsAt, status: appointment.status } };
    },
  },

  cancel_appointment: {
    name: "cancel_appointment",
    description: "Cancel an existing appointment.",
    mutating: true,
    schema: z.object({ appointmentId: z.string().uuid() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { appointmentId: string };
      await assertAppointmentOwned(ctx, input.appointmentId);
      const appointment = await transitionAppointment(ctx.businessId, await aiActorId(ctx.businessId), input.appointmentId, "CANCELED");
      return { output: { appointmentId: appointment.id, status: appointment.status } };
    },
  },

  get_business_info: {
    name: "get_business_info",
    description: "Return the business profile, services and working hours.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run(ctx) {
      const knowledge = await deriveBusinessKnowledge(ctx.businessId);
      return { output: { facts: knowledge.map((item) => ({ kind: item.kind, title: item.title, content: item.content, source: item.source })) } };
    },
  },

  answer_faq: {
    name: "answer_faq",
    description: "Retrieve the most relevant stored knowledge for a customer question.",
    mutating: false,
    schema: z.object({ query: z.string().trim().min(1).max(500) }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { query: string };
      const result = await retrieveMemory({
        businessId: ctx.businessId,
        phase: "RESPONSE",
        runId: ctx.runId,
        conversationId: ctx.conversationId,
        customerId: ctx.customerId ?? undefined,
        query: input.query,
        persistLog: false,
      });
      return { output: { matches: result.items.slice(0, 6).map((item) => ({ content: item.content, source: item.source })) } };
    },
  },

  request_information: {
    name: "request_information",
    description: "Record a question the AI needs the customer to answer before it can proceed.",
    mutating: false,
    schema: z.object({ question: z.string().trim().min(1).max(500) }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { question: string };
      const questionId = await addPendingQuestion(ctx.businessId, ctx.runId, input.question);
      return { output: { questionId, question: input.question } };
    },
  },

  escalate_to_human: {
    name: "escalate_to_human",
    description: "Hand the conversation to a human team member.",
    mutating: true,
    schema: z.object({ reason: z.string().trim().max(500).optional() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { reason?: string };
      await prisma.conversation.updateMany({
        where: { id: ctx.conversationId, businessId: ctx.businessId },
        data: { automationMode: "HUMAN", status: "PENDING", waitingSince: new Date() },
      });
      await prisma.conversationLifecycleEvent.create({
        data: { businessId: ctx.businessId, conversationId: ctx.conversationId, type: "AI_ESCALATED", metadata: { reason: input.reason ?? "AI requested escalation", runId: ctx.runId } },
      });
      return { output: { escalated: true, reason: input.reason ?? null } };
    },
  },
};

async function assertAppointmentOwned(ctx: AgentToolContext, appointmentId: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, businessId: ctx.businessId }, select: { customerId: true } });
  if (!appointment) throw ApiError.notFound("Appointment not found");
  if (ctx.customerId && appointment.customerId && appointment.customerId !== ctx.customerId) {
    throw ApiError.forbidden("That appointment belongs to a different customer");
  }
}

export const AGENT_TOOL_NAMES = Object.keys(tools);
export function getAgentTool(name: string): AgentTool | undefined {
  return tools[name];
}
export function isAgentTool(name: string): boolean {
  return name in tools;
}
