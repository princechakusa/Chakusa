import { prisma } from "../../lib/prisma.js";
import { classifyCustomerLifecycleStage, type CustomerLifecycleStage } from "../../lib/customerLifecycle.js";
import { ApiError } from "../../lib/errors.js";

export type SmartAudienceKey = "new" | "returning" | "loyal" | "vip" | "dormant" | "high_value" | "outstanding_payments" | "needs_reviews" | "active_reminders";

export interface AudienceMember {
  customerId: string;
  name: string;
  lifecycleStage: CustomerLifecycleStage;
  lifetimeValue: number;
  outstandingAmount: number;
  manualTagIds: string[];
  systemTags: string[];
}

export interface AudienceSummary { key: SmartAudienceKey; label: string; customerIds: string[]; totalCustomers: number; averageValue: number; repeatRate: number | null; revenue: number; outstandingPayments: number; }

const AUDIENCES: { key: SmartAudienceKey; label: string; matches: (member: AudienceMember & { hasPendingReview: boolean; hasActiveReminder: boolean; wonLeadCount: number }) => boolean }[] = [
  { key: "new", label: "New customers", matches: m => m.lifecycleStage === "new_lead" || m.lifecycleStage === "first_customer" },
  { key: "returning", label: "Returning customers", matches: m => m.lifecycleStage === "returning" },
  { key: "loyal", label: "Loyal customers", matches: m => m.lifecycleStage === "loyal" },
  { key: "vip", label: "VIP customers", matches: m => m.lifecycleStage === "vip" },
  { key: "dormant", label: "Dormant customers", matches: m => m.lifecycleStage === "dormant" },
  { key: "high_value", label: "High-value customers", matches: m => m.lifetimeValue > 0 && m.lifetimeValue >= 1000 },
  { key: "outstanding_payments", label: "Outstanding payments", matches: m => m.outstandingAmount > 0 },
  { key: "needs_reviews", label: "Needs reviews", matches: m => m.wonLeadCount > 0 && m.hasPendingReview },
  { key: "active_reminders", label: "Active reminders", matches: m => m.hasActiveReminder },
];

async function buildAudienceCenter(businessId: string, includeTagData: boolean) {
  const now = new Date();
  const customersPromise = includeTagData
    ? prisma.customer.findMany({ where: { businessId }, select: { id: true, name: true, tagAssignments: { select: { tagId: true } } }, orderBy: { createdAt: "desc" } })
      .then(customers => customers.map(customer => ({ id: customer.id, name: customer.name, manualTagIds: customer.tagAssignments.map(assignment => assignment.tagId) })))
    : prisma.customer.findMany({ where: { businessId }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } })
      .then(customers => customers.map(customer => ({ id: customer.id, name: customer.name, manualTagIds: [] as string[] })));
  const [customers, leads, reviews, reminders, tags] = await Promise.all([
    customersPromise,
    prisma.lead.findMany({ where: { businessId } }),
    prisma.reviewRequest.findMany({ where: { businessId } }),
    prisma.reminder.findMany({ where: { businessId } }),
    includeTagData ? prisma.customerTag.findMany({ where: { businessId }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const leadsByCustomer = new Map<string, typeof leads>();
  for (const lead of leads) {
    if (!lead.customerId) continue;
    const existing = leadsByCustomer.get(lead.customerId);
    if (existing) existing.push(lead);
    else leadsByCustomer.set(lead.customerId, [lead]);
  }
  const pendingReviewCustomerIds = new Set(reviews.filter(review => review.customerId && ["pending", "sent", "opened"].includes(review.status)).map(review => review.customerId!));
  const activeReminderCustomerIds = new Set(reminders.filter(reminder => reminder.customerId && ["due", "sent"].includes(reminder.status)).map(reminder => reminder.customerId!));
  const members = customers.map(customer => {
    const ownLeads = leadsByCustomer.get(customer.id) ?? [];
    const won = ownLeads.filter(lead => lead.status === "won");
    const lifetimeValue = won.reduce((sum, lead) => sum + Number(lead.estimatedValue ?? 0), 0);
    const outstandingAmount = won.filter(lead => lead.paymentStatus !== "paid").reduce((sum, lead) => sum + Math.max(0, Number(lead.estimatedValue ?? 0) - Number(lead.paidAmount ?? 0)), 0);
    const latest = ownLeads.reduce<Date | null>((value, lead) => !value || lead.createdAt > value ? lead.createdAt : value, null);
    const lifecycleStage = classifyCustomerLifecycleStage({ lostLeadCount: ownLeads.filter(l => l.status === "lost").length, contactedOrBookedLeadCount: ownLeads.filter(l => l.status === "contacted" || l.status === "booked").length, newLeadCount: ownLeads.filter(l => l.status === "new").length, wonLeadCount: won.length, lifetimeValue, daysSinceLastActivity: latest ? Math.floor((now.getTime() - latest.getTime()) / 86_400_000) : null });
    const hasPendingReview = pendingReviewCustomerIds.has(customer.id);
    const hasActiveReminder = activeReminderCustomerIds.has(customer.id);
    const manualTagIds = customer.manualTagIds;
    return { customerId: customer.id, name: customer.name, lifecycleStage, lifetimeValue, outstandingAmount, manualTagIds, systemTags: [lifecycleStage, ...(outstandingAmount > 0 ? ["payment_outstanding"] : []), ...(hasPendingReview ? ["waiting_for_review"] : []), ...(hasActiveReminder ? ["active_reminder"] : [])], hasPendingReview, hasActiveReminder, wonLeadCount: won.length };
  });
  const audiences = AUDIENCES.map(audience => {
    const matching = members.filter(audience.matches);
    const revenue = matching.reduce((sum, member) => sum + member.lifetimeValue, 0);
    return { key: audience.key, label: audience.label, customerIds: matching.map(member => member.customerId), totalCustomers: matching.length, averageValue: matching.length ? revenue / matching.length : 0, repeatRate: matching.length ? matching.filter(member => member.wonLeadCount >= 2).length / matching.length : null, revenue, outstandingPayments: matching.reduce((sum, member) => sum + member.outstandingAmount, 0) };
  });
  return { audiences, members: members.map(({ hasPendingReview: _review, hasActiveReminder: _reminder, wonLeadCount: _won, ...member }) => member), tags };
}

export async function getAudienceCenter(businessId: string) {
  return buildAudienceCenter(businessId, true);
}

export async function getAudienceSummaries(businessId: string) {
  return (await buildAudienceCenter(businessId, false)).audiences;
}

export async function createCustomerTag(businessId: string, name: string) { return prisma.customerTag.create({ data: { businessId, name: name.trim() } }); }
export async function setCustomerTags(businessId: string, customerId: string, tagIds: string[]) {
  const count = await prisma.customer.count({ where: { id: customerId, businessId } });
  if (!count) throw ApiError.notFound("Customer not found");
  const tags = await prisma.customerTag.findMany({ where: { businessId, id: { in: tagIds } }, select: { id: true } });
  if (tags.length !== new Set(tagIds).size) throw ApiError.notFound("One or more tags were not found");
  await prisma.$transaction([prisma.customerTagAssignment.deleteMany({ where: { customerId } }), prisma.customerTagAssignment.createMany({ data: tags.map(tag => ({ customerId, tagId: tag.id })) })]);
  return prisma.customerTagAssignment.findMany({ where: { customerId }, include: { tag: true } });
}
