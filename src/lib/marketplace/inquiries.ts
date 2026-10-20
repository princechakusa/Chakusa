import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { notifyCustomer } from "../customer/customerNotifications.js";
import { notifyCustomerInquiry } from "../notifications/notificationTriggers.js";
import { businessPhotoPath } from "../imageDataUrl.js";
import type { PushProvider } from "../push/pushProvider.js";

// Customer <-> business in-app messaging ("Ask the business"). One thread per
// customer per business, stored as a normal inbox Conversation so the
// business answers from its existing inbox (#18). The customer side is
// scoped by `contextId = customerProfileId`; only in-app messages are ever
// returned to the customer, so SMS/WhatsApp traffic and internal notes on
// the same business never leak into this view.

export const INQUIRY_CONTEXT = "CUSTOMER_APP_INQUIRY";
export const IN_APP_PROVIDER = "in_app";
const BODY_MAX = 2000;
// Abuse guard: inbound messages one customer may send across all businesses.
const HOURLY_SEND_LIMIT = 30;

function cleanBody(body: string) {
  const text = body.replace(/\u0000/g, "").trim();
  if (!text) throw ApiError.badRequest("Write a message first");
  if (text.length > BODY_MAX) throw ApiError.badRequest(`Messages can be up to ${BODY_MAX} characters`);
  return text;
}

async function visibleBusinessBySlug(slug: string) {
  const business = await prisma.business.findFirst({
    where: { publicSlug: slug, platformStatus: "ACTIVE", OR: [{ marketplaceListing: null }, { marketplaceListing: { listed: true, discoverable: true } }] },
    select: { id: true, name: true, publicSlug: true, logoDataUrl: true, updatedAt: true },
  });
  if (!business) throw ApiError.notFound("Business not found");
  return business;
}

async function customerName(customerProfileId: string) {
  const profile = await prisma.customerProfile.findUnique({ where: { id: customerProfileId }, select: { displayName: true, user: { select: { fullName: true } } } });
  return profile?.displayName?.trim() || profile?.user?.fullName?.trim() || "Chakusa customer";
}

function serializeMessage(message: { id: string; body: string; direction: string; createdAt: Date; readAt: Date | null }) {
  return { id: message.id, body: message.body, fromBusiness: message.direction === "OUTBOUND", createdAt: message.createdAt, readAt: message.readAt };
}

/** Sends a customer's message to a business, opening the thread on first contact. */
export async function sendCustomerInquiry(customerProfileId: string, slug: string, body: string, pushProvider?: PushProvider) {
  const text = cleanBody(body);
  const business = await visibleBusinessBySlug(slug);
  const link = await prisma.customerBusinessLink.findUnique({ where: { customerProfileId_businessId: { customerProfileId, businessId: business.id } }, select: { blockedByBusiness: true } });
  if (link?.blockedByBusiness) throw ApiError.forbidden("This business isn't accepting messages from you");

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.message.count({
    where: { provider: IN_APP_PROVIDER, direction: "INBOUND", createdAt: { gte: since }, conversation: { contextType: INQUIRY_CONTEXT, contextId: customerProfileId } },
  });
  if (recent >= HOURLY_SEND_LIMIT) throw ApiError.tooManyRequests("You've sent a lot of messages. Try again in a little while");

  const name = await customerName(customerProfileId);
  const now = new Date();
  const { conversation, message } = await prisma.$transaction(async (tx) => {
    let conversation = await tx.conversation.findFirst({ where: { businessId: business.id, contextType: INQUIRY_CONTEXT, contextId: customerProfileId, deletedAt: null }, select: { id: true } });
    if (!conversation) {
      conversation = await tx.conversation.create({ data: { businessId: business.id, contextType: INQUIRY_CONTEXT, contextId: customerProfileId, subject: name, automationMode: "HUMAN" }, select: { id: true } });
    }
    const message = await tx.message.create({
      data: { businessId: business.id, conversationId: conversation.id, messageType: "custom", channel: "other", provider: IN_APP_PROVIDER, direction: "INBOUND", actorType: "CUSTOMER", status: "delivered", body: text, sentAt: now, deliveredAt: now },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { status: "OPEN", lastInboundAt: now, waitingSince: now, archivedAt: null } });
    await tx.customerBusinessLink.upsert({
      where: { customerProfileId_businessId: { customerProfileId, businessId: business.id } },
      create: { customerProfileId, businessId: business.id, relationship: "CUSTOMER", firstInteractionAt: now, lastInteractionAt: now },
      update: { lastInteractionAt: now },
    });
    return { conversation, message };
  });

  await notifyCustomerInquiry(business.id, { conversationId: conversation.id, customerName: name, preview: text }, pushProvider);
  return { threadId: conversation.id, message: serializeMessage(message) };
}

/** The customer's threads, newest first. */
export async function listCustomerInquiries(customerProfileId: string) {
  const threads = await prisma.conversation.findMany({
    where: { contextType: INQUIRY_CONTEXT, contextId: customerProfileId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, businessId: true, updatedAt: true, messages: { where: { provider: IN_APP_PROVIDER, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, body: true, direction: true, createdAt: true, readAt: true } } },
  });
  const businessIds = [...new Set(threads.map((t) => t.businessId))];
  const [businesses, unread] = await Promise.all([
    prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true, logoDataUrl: true, updatedAt: true } }),
    prisma.message.groupBy({ by: ["conversationId"], where: { conversationId: { in: threads.map((t) => t.id) }, provider: IN_APP_PROVIDER, direction: "OUTBOUND", readAt: null, deletedAt: null }, _count: { _all: true } }),
  ]);
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const unreadById = new Map(unread.map((row) => [row.conversationId, row._count._all]));
  return threads.map((thread) => {
    const business = businessById.get(thread.businessId);
    return {
      id: thread.id,
      business: business ? { name: business.name, slug: business.publicSlug, photoUrl: businessPhotoPath(business) } : null,
      lastMessage: thread.messages[0] ? serializeMessage(thread.messages[0]) : null,
      unreadCount: unreadById.get(thread.id) ?? 0,
      updatedAt: thread.updatedAt,
    };
  });
}

async function ownedThread(customerProfileId: string, threadId: string) {
  const thread = await prisma.conversation.findFirst({ where: { id: threadId, contextType: INQUIRY_CONTEXT, contextId: customerProfileId, deletedAt: null }, select: { id: true, businessId: true } });
  if (!thread) throw ApiError.notFound("Conversation not found");
  return thread;
}

/** One thread with its in-app messages; opening it marks the business's replies read. */
export async function getCustomerInquiry(customerProfileId: string, threadId: string) {
  const thread = await ownedThread(customerProfileId, threadId);
  const [business, messages] = await Promise.all([
    prisma.business.findUnique({ where: { id: thread.businessId }, select: { name: true, publicSlug: true, logoDataUrl: true, updatedAt: true } }),
    prisma.message.findMany({ where: { conversationId: thread.id, provider: IN_APP_PROVIDER, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, body: true, direction: true, createdAt: true, readAt: true } }),
  ]);
  await prisma.message.updateMany({ where: { conversationId: thread.id, provider: IN_APP_PROVIDER, direction: "OUTBOUND", readAt: null }, data: { readAt: new Date() } });
  return {
    id: thread.id,
    business: business ? { name: business.name, slug: business.publicSlug, photoUrl: businessPhotoPath(business) } : null,
    messages: messages.map(serializeMessage),
  };
}

/** Customer follow-up in an existing thread. */
export async function replyToCustomerInquiry(customerProfileId: string, threadId: string, body: string, pushProvider?: PushProvider) {
  const thread = await ownedThread(customerProfileId, threadId);
  const business = await prisma.business.findUnique({ where: { id: thread.businessId }, select: { publicSlug: true } });
  if (!business?.publicSlug) throw ApiError.notFound("Business not found");
  return sendCustomerInquiry(customerProfileId, business.publicSlug, body, pushProvider);
}

/** A business member's in-app reply to a customer thread, delivered by push. */
export async function sendBusinessInquiryReply(businessId: string, conversationId: string, body: string, pushProvider?: PushProvider) {
  const text = cleanBody(body);
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, businessId, deletedAt: null }, select: { id: true, contextType: true, contextId: true } });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  if (conversation.contextType !== INQUIRY_CONTEXT || !conversation.contextId) throw ApiError.badRequest("This conversation isn't with a Chakusa app customer");
  const customerProfileId = conversation.contextId;

  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { businessId, conversationId, messageType: "custom", channel: "other", provider: IN_APP_PROVIDER, direction: "OUTBOUND", actorType: "HUMAN", status: "delivered", body: text, sentAt: now, deliveredAt: now },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: now, lastReadAt: now, waitingSince: null, status: "PENDING" } });
    return message;
  });

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, publicSlug: true } });
  try {
    await notifyCustomer({
      customerProfileId,
      category: "message",
      title: business?.name ?? "New reply",
      body: text.length > 140 ? `${text.slice(0, 139)}…` : text,
      businessId,
      data: { type: "inquiry_reply", threadId: conversationId, slug: business?.publicSlug ?? null },
    }, pushProvider);
  } catch (err) {
    console.error("[inquiries] customer notification failed", err);
  }
  return serializeMessage(message);
}
