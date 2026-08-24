import { prisma } from "../../lib/prisma.js";
import type { CreateBetaFeedbackInput, CreateSupportTicketInput } from "./support.schemas.js";

const RESPONSE_WINDOW_MS = 2 * 86_400_000;

export function expectedSupportResponseAt(now = new Date()) {
  return new Date(now.getTime() + RESPONSE_WINDOW_MS);
}

export async function createSupportTicket(businessId: string, userId: string, input: CreateSupportTicketInput, now = new Date()) {
  return prisma.supportTicket.create({ data: { businessId, createdByUserId: userId, ...input, expectedResponseAt: expectedSupportResponseAt(now) } });
}

export async function listSupportTickets(businessId: string) {
  return prisma.supportTicket.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function createBetaFeedback(businessId: string, userId: string, input: CreateBetaFeedbackInput) {
  return prisma.betaFeedback.create({ data: { businessId, createdByUserId: userId, ...input } });
}
