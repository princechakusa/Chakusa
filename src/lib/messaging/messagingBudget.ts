import { prisma } from "../prisma.js";
import { config } from "../config.js";

export async function messagingBudgetAvailable(businessId: string, now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await prisma.message.count({ where: { businessId, createdAt: { gte: periodStart }, status: { in: ["sent", "delivered"] } } });
  return { available: used < config.TWILIO_MONTHLY_MESSAGE_LIMIT, used, limit: config.TWILIO_MONTHLY_MESSAGE_LIMIT, periodStart };
}
