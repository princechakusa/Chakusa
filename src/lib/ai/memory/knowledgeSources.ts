import { prisma } from "../../prisma.js";
import type { MemoryItem } from "./memoryTypes.js";

// Derived knowledge: computed on read from the systems of record (Business,
// ServiceOffering, Appointment, Feedback, payments, Message, prior AI runs).
// Never stored — so it can never go stale — and every item carries a
// `source` that points back at the row it came from.

const derived = (partial: Omit<MemoryItem, "pinned" | "confidence" | "origin">): MemoryItem => ({
  pinned: false,
  confidence: null,
  origin: "derived",
  ...partial,
});

function money(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "n/a";
}

export async function deriveBusinessKnowledge(businessId: string): Promise<MemoryItem[]> {
  const [business, services, members] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, description: true, timezone: true, currency: true, country: true, preferredTone: true, workingHours: true, googleReviewLink: true },
    }),
    prisma.serviceOffering.findMany({
      where: { businessId, active: true },
      orderBy: { sortOrder: "asc" },
      take: 60,
      select: { id: true, name: true, description: true, category: true, durationMinutes: true, price: true, depositAmount: true, updatedAt: true, createdAt: true },
    }),
    prisma.businessMember.findMany({
      where: { businessId, status: "ACTIVE" },
      take: 40,
      select: { id: true, role: true, createdAt: true, user: { select: { fullName: true } } },
    }),
  ]);
  if (!business) return [];
  const now = new Date();
  const items: MemoryItem[] = [];

  items.push(
    derived({
      id: `biz:${businessId}:profile`,
      scope: "BUSINESS",
      kind: "business_profile",
      title: business.name,
      content: `Business "${business.name}"${business.industry ? `, industry ${business.industry}` : ""}${business.country ? `, ${business.country}` : ""}, timezone ${business.timezone ?? "UTC"}, currency ${business.currency ?? "n/a"}.${business.description ? ` About: ${business.description}` : ""}`,
      source: "business.profile",
      sourceRef: businessId,
      importance: 0.85,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    }),
  );

  items.push(
    derived({
      id: `biz:${businessId}:brand_voice`,
      scope: "BUSINESS",
      kind: "brand_voice",
      title: "Brand voice",
      content: `Preferred tone for customer messages: ${business.preferredTone}.`,
      source: "business.preferredTone",
      sourceRef: businessId,
      importance: 0.8,
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
    }),
  );

  if (business.workingHours) {
    items.push(
      derived({
        id: `biz:${businessId}:working_hours`,
        scope: "BUSINESS",
        kind: "working_hours",
        title: "Working hours",
        content: `Configured working hours: ${JSON.stringify(business.workingHours)}`,
        data: business.workingHours,
        source: "business.workingHours",
        sourceRef: businessId,
        importance: 0.7,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  const categories = [...new Set(services.map((service) => service.category).filter((value): value is string => Boolean(value)))];
  if (categories.length) {
    items.push(
      derived({
        id: `biz:${businessId}:service_categories`,
        scope: "BUSINESS",
        kind: "service_category",
        title: "Service categories",
        content: `Service categories offered: ${categories.join(", ")}.`,
        source: "service_offerings.category",
        importance: 0.6,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  for (const service of services) {
    items.push(
      derived({
        id: `biz:service:${service.id}`,
        scope: "BUSINESS",
        kind: "service",
        title: service.name,
        content: `Service "${service.name}"${service.category ? ` (${service.category})` : ""}: ${service.durationMinutes} min, price ${money(service.price)}${service.depositAmount ? `, deposit ${money(service.depositAmount)}` : ""}.${service.description ? ` ${service.description}` : ""}`,
        data: { id: service.id, price: service.price, durationMinutes: service.durationMinutes },
        source: `service_offering:${service.id}`,
        sourceRef: service.id,
        importance: 0.65,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        expiresAt: null,
      }),
    );
  }

  const priced = services.filter((service) => service.price != null);
  if (priced.length) {
    items.push(
      derived({
        id: `biz:${businessId}:pricing_rules`,
        scope: "BUSINESS",
        kind: "pricing_rule",
        title: "Pricing",
        content: `Current pricing: ${priced.map((service) => `${service.name} ${money(service.price)}`).join("; ")}.`,
        source: "service_offerings.price",
        importance: 0.7,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  for (const member of members) {
    items.push(
      derived({
        id: `biz:member:${member.id}`,
        scope: "BUSINESS",
        kind: "staff",
        title: member.user.fullName,
        content: `Staff member ${member.user.fullName} (${member.role}).`,
        source: `business_member:${member.id}`,
        sourceRef: member.id,
        importance: 0.5,
        createdAt: member.createdAt,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  return items;
}

export async function deriveCustomerKnowledge(businessId: string, customerId: string): Promise<MemoryItem[]> {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) return []; // tenant isolation: a customer of another business yields nothing

  const [appointments, feedback, tags, preference, consent, priorRuns, priorDecisions, recentMessages, payments] = await Promise.all([
    prisma.appointment.findMany({ where: { businessId, customerId }, orderBy: { startsAt: "desc" }, take: 12, select: { id: true, serviceName: true, startsAt: true, status: true, price: true, paidAmount: true, paymentStatus: true, createdAt: true } }),
    prisma.feedback.findMany({ where: { businessId, customerId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, rating: true, sentiment: true, comment: true, createdAt: true } }),
    prisma.customerTagAssignment.findMany({ where: { customerId }, select: { tag: { select: { name: true, businessId: true } } } }),
    prisma.customerCommunicationPreference.findUnique({ where: { businessId_customerId: { businessId, customerId } } }),
    prisma.customerConsentEvent.findMany({ where: { businessId, customerId }, orderBy: { occurredAt: "desc" }, take: 5 }),
    prisma.aIConversationRun.findMany({ where: { businessId, customerId }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, status: true, mode: true, updatedAt: true, createdAt: true } }),
    prisma.aIPolicyDecision.findMany({ where: { businessId, customerId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, checkpoint: true, action: true, outcome: true, createdAt: true } }),
    prisma.message.findMany({ where: { businessId, customerId, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, direction: true, body: true, channel: true, createdAt: true } }),
    prisma.appointmentPaymentTransaction.findMany({ where: { businessId, appointment: { customerId } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, kind: true, status: true, amount: true, currency: true, paidAt: true, createdAt: true } }),
  ]);
  const now = new Date();
  const items: MemoryItem[] = [];

  items.push(
    derived({
      id: `cust:${customerId}:profile`,
      scope: "CUSTOMER",
      kind: "customer_profile",
      title: customer.name,
      content: `Customer ${customer.name}${customer.email ? ` <${customer.email}>` : ""}${customer.phoneE164 ? ` (${customer.phoneE164})` : ""}. Known since ${customer.createdAt.toISOString().slice(0, 10)}.${customer.notes ? ` Notes: ${customer.notes}` : ""}`,
      data: customer.customFields ?? undefined,
      source: `customer:${customerId}`,
      sourceRef: customerId,
      importance: 0.8,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      expiresAt: null,
    }),
  );

  const tagNames = tags.map((assignment) => assignment.tag).filter((tag) => tag.businessId === businessId).map((tag) => tag.name);
  if (tagNames.length) {
    items.push(
      derived({
        id: `cust:${customerId}:tags`,
        scope: "CUSTOMER",
        kind: "tag",
        title: "Tags",
        content: `Customer tags: ${tagNames.join(", ")}.`,
        source: `customer:${customerId}:tags`,
        importance: 0.55,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  if (appointments.length) {
    const completed = appointments.filter((appointment) => appointment.status === "COMPLETED").length;
    const noShows = appointments.filter((appointment) => appointment.status === "NO_SHOW").length;
    const lastVisit = appointments.find((appointment) => appointment.startsAt < now);
    const totalSpend = appointments.reduce((sum, appointment) => sum + Number(appointment.paidAmount ?? 0), 0);
    items.push(
      derived({
        id: `cust:${customerId}:appointment_summary`,
        scope: "CUSTOMER",
        kind: "appointment_summary",
        title: "Appointment history",
        content: `${appointments.length} appointments on record (${completed} completed, ${noShows} no-shows). Last visit ${lastVisit ? lastVisit.startsAt.toISOString().slice(0, 10) : "n/a"}. Recorded spend ${totalSpend.toFixed(2)}.`,
        source: `appointments:customer:${customerId}`,
        importance: 0.75,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
    for (const appointment of appointments.slice(0, 6)) {
      items.push(
        derived({
          id: `cust:appt:${appointment.id}`,
          scope: "CUSTOMER",
          kind: "appointment",
          title: appointment.serviceName,
          content: `${appointment.serviceName} on ${appointment.startsAt.toISOString().slice(0, 16)} — ${appointment.status}, payment ${appointment.paymentStatus} (${money(appointment.paidAmount)}/${money(appointment.price)}).`,
          source: `appointment:${appointment.id}`,
          sourceRef: appointment.id,
          importance: 0.5,
          createdAt: appointment.createdAt,
          updatedAt: appointment.startsAt,
          expiresAt: null,
        }),
      );
    }
    // Loyalty indicator
    const recency = lastVisit ? Math.round((now.getTime() - lastVisit.startsAt.getTime()) / 86_400_000) : null;
    const tier = completed >= 10 ? "VIP" : completed >= 4 ? "loyal" : completed >= 1 ? "returning" : "new";
    items.push(
      derived({
        id: `cust:${customerId}:loyalty`,
        scope: "CUSTOMER",
        kind: "loyalty",
        title: "Loyalty",
        content: `Loyalty indicator: ${tier} (${completed} completed visits, ${recency == null ? "no" : `${recency}-day`} recency, spend ${totalSpend.toFixed(2)}).`,
        source: `appointments:customer:${customerId}`,
        importance: 0.7,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  if (payments.length) {
    const paid = payments.filter((payment) => payment.status === "paid");
    items.push(
      derived({
        id: `cust:${customerId}:payments`,
        scope: "CUSTOMER",
        kind: "payment",
        title: "Payments",
        content: `${payments.length} payment transactions, ${paid.length} paid. Most recent: ${payments[0]?.kind} ${money(payments[0]?.amount)} ${payments[0]?.currency ?? ""} (${payments[0]?.status}).`,
        source: `payments:customer:${customerId}`,
        importance: 0.55,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
  }

  if (feedback.length) {
    const avg = feedback.reduce((sum, entry) => sum + entry.rating, 0) / feedback.length;
    const sentiments = feedback.map((entry) => entry.sentiment).filter(Boolean);
    items.push(
      derived({
        id: `cust:${customerId}:sentiment_history`,
        scope: "CUSTOMER",
        kind: "sentiment_history",
        title: "Sentiment history",
        content: `${feedback.length} reviews, average rating ${avg.toFixed(1)}/5. Sentiment trail: ${sentiments.join(", ") || "n/a"}.`,
        source: `feedback:customer:${customerId}`,
        importance: 0.7,
        createdAt: now,
        updatedAt: now,
        expiresAt: null,
      }),
    );
    for (const entry of feedback.slice(0, 4)) {
      items.push(
        derived({
          id: `cust:review:${entry.id}`,
          scope: "CUSTOMER",
          kind: "review",
          title: `Rating ${entry.rating}/5`,
          content: `Review ${entry.rating}/5${entry.sentiment ? ` (${entry.sentiment})` : ""}${entry.comment ? `: ${entry.comment}` : ""} — ${entry.createdAt.toISOString().slice(0, 10)}.`,
          source: `feedback:${entry.id}`,
          sourceRef: entry.id,
          importance: 0.5,
          createdAt: entry.createdAt,
          updatedAt: entry.createdAt,
          expiresAt: null,
        }),
      );
    }
  }

  if (preference) {
    items.push(
      derived({
        id: `cust:${customerId}:communication_preference`,
        scope: "CUSTOMER",
        kind: "communication_preference",
        title: "Communication preferences",
        content: `Preferred channels ${JSON.stringify(preference.preferredChannels)}, language ${preference.language}, timezone ${preference.timezone}. Consent — marketing:${preference.marketingConsent} transactional:${preference.transactionalConsent} service:${preference.serviceConsent}.`,
        data: preference.quietHours ?? undefined,
        source: `customer_communication_preference:${customerId}`,
        importance: 0.75,
        createdAt: preference.createdAt,
        updatedAt: preference.updatedAt,
        expiresAt: null,
      }),
    );
  }

  if (consent.length) {
    items.push(
      derived({
        id: `cust:${customerId}:consent`,
        scope: "CUSTOMER",
        kind: "consent",
        title: "Consent",
        content: `Latest consent events: ${consent.map((event) => `${event.purpose}=${event.granted ? "granted" : "withdrawn"}${event.channel ? `(${event.channel})` : ""}`).join(", ")}.`,
        source: `customer_consent_events:${customerId}`,
        importance: 0.7,
        createdAt: consent[0]?.occurredAt ?? now,
        updatedAt: consent[0]?.occurredAt ?? now,
        expiresAt: null,
      }),
    );
  }

  if (recentMessages.length) {
    items.push(
      derived({
        id: `cust:${customerId}:communication_history`,
        scope: "CUSTOMER",
        kind: "communication_history",
        title: "Recent messages",
        content: recentMessages
          .slice(0, 6)
          .map((message) => `${message.direction === "OUTBOUND" ? "→" : "←"} [${message.channel}] ${message.body.slice(0, 160)}`)
          .join("\n"),
        source: `messages:customer:${customerId}`,
        importance: 0.6,
        createdAt: recentMessages[recentMessages.length - 1]?.createdAt ?? now,
        updatedAt: recentMessages[0]?.createdAt ?? now,
        expiresAt: null,
      }),
    );
  }

  for (const run of priorRuns) {
    items.push(
      derived({
        id: `cust:airun:${run.id}`,
        scope: "CUSTOMER",
        kind: "prior_ai_conversation",
        title: `AI run ${run.status}`,
        content: `Previous AI conversation ${run.id.slice(0, 8)} ended ${run.status} (mode ${run.mode}) on ${run.updatedAt.toISOString().slice(0, 10)}.`,
        source: `ai_conversation_run:${run.id}`,
        sourceRef: run.id,
        importance: 0.5,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        expiresAt: null,
      }),
    );
  }

  if (priorDecisions.length) {
    items.push(
      derived({
        id: `cust:${customerId}:prior_ai_decisions`,
        scope: "CUSTOMER",
        kind: "prior_ai_decision",
        title: "Prior AI decisions",
        content: `Recent policy decisions for this customer: ${priorDecisions.map((decision) => `${decision.checkpoint}/${decision.action}→${decision.outcome}`).join(", ")}.`,
        source: `ai_policy_decisions:customer:${customerId}`,
        importance: 0.55,
        createdAt: priorDecisions[0]?.createdAt ?? now,
        updatedAt: priorDecisions[0]?.createdAt ?? now,
        expiresAt: null,
      }),
    );
  }

  return items;
}

export async function deriveConversationKnowledge(businessId: string, conversationId: string): Promise<MemoryItem[]> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId },
    select: { id: true, subject: true, status: true, priority: true, createdAt: true, updatedAt: true },
  });
  if (!conversation) return [];
  const messages = await prisma.message.findMany({
    where: { businessId, conversationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { id: true, direction: true, body: true, createdAt: true },
  });
  const items: MemoryItem[] = [
    {
      id: `conv:${conversationId}:meta`,
      scope: "CONVERSATION",
      kind: "conversation_meta",
      title: conversation.subject ?? "Conversation",
      content: `Conversation ${conversation.subject ? `"${conversation.subject}" ` : ""}status ${conversation.status}, priority ${conversation.priority}, ${messages.length} messages.`,
      source: `conversation:${conversationId}`,
      sourceRef: conversationId,
      importance: 0.6,
      pinned: false,
      confidence: null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      expiresAt: null,
      origin: "derived",
    },
  ];
  for (const message of messages.slice(-8)) {
    items.push({
      id: `conv:msg:${message.id}`,
      scope: "CONVERSATION",
      kind: "message",
      title: message.direction,
      content: `${message.direction === "OUTBOUND" ? "→" : "←"} ${message.body.slice(0, 240)}`,
      source: `message:${message.id}`,
      sourceRef: message.id,
      importance: 0.45,
      pinned: false,
      confidence: null,
      createdAt: message.createdAt,
      updatedAt: message.createdAt,
      expiresAt: null,
      origin: "derived",
    });
  }
  return items;
}

export async function deriveLongTermKnowledge(businessId: string): Promise<MemoryItem[]> {
  const workflows = await prisma.workflowExecution.findMany({
    where: { businessId, status: { in: ["COMPLETED", "FAILED"] } },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { id: true, status: true, workflowId: true, updatedAt: true, createdAt: true },
  });
  if (!workflows.length) return [];
  const now = new Date();
  return [
    {
      id: `biz:${businessId}:historical_workflows`,
      scope: "LONG_TERM",
      kind: "historical_workflow",
      title: "Recent workflow executions",
      content: `Recent workflow runs: ${workflows.map((execution) => `${execution.workflowId.slice(0, 8)}→${execution.status}`).join(", ")}.`,
      source: `workflow_executions:business:${businessId}`,
      importance: 0.4,
      pinned: false,
      confidence: null,
      createdAt: workflows[workflows.length - 1]?.createdAt ?? now,
      updatedAt: workflows[0]?.updatedAt ?? now,
      expiresAt: null,
      origin: "derived",
    },
  ];
}
