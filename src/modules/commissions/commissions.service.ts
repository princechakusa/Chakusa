import { Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { computeCommissionReport } from "../../lib/commissions/commissions.domain.js";
import type { CommissionReportQuery, UpsertCommissionRuleInput } from "./commissions.schemas.js";

function serializeRule(row: Prisma.MemberCommissionRuleGetPayload<{ include: { businessMember: { include: { user: { select: { fullName: true } } } }; serviceOffering: { select: { name: true } } } }>) {
  return {
    id: row.id,
    businessMemberId: row.businessMemberId,
    memberName: row.businessMember.user.fullName,
    serviceOfferingId: row.serviceOfferingId,
    serviceName: row.serviceOffering?.name ?? null,
    basis: row.basis,
    ratePercent: row.ratePercent == null ? null : row.ratePercent.toFixed(3),
    fixedAmount: row.fixedAmount == null ? null : row.fixedAmount.toFixed(2),
    fixedCurrency: row.fixedCurrency,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ruleInclude = { businessMember: { include: { user: { select: { fullName: true } } } }, serviceOffering: { select: { name: true } } } as const;

export async function listCommissionRules(businessId: string) {
  const rows = await prisma.memberCommissionRule.findMany({
    where: { businessId },
    include: ruleInclude,
    orderBy: [{ businessMember: { user: { fullName: "asc" } } }, { serviceOfferingId: "asc" }],
  });
  return rows.map(serializeRule);
}

export async function upsertCommissionRule(businessId: string, actorId: string, input: UpsertCommissionRuleInput) {
  const serviceOfferingId = input.serviceOfferingId ?? null;
  return prisma.$transaction(async tx => {
    const member = await tx.businessMember.findFirst({ where: { id: input.businessMemberId, businessId }, select: { id: true } });
    if (!member) throw ApiError.badRequest("businessMemberId is not a member of this business");
    if (serviceOfferingId && !await tx.serviceOffering.findFirst({ where: { id: serviceOfferingId, businessId }, select: { id: true } })) {
      throw ApiError.badRequest("serviceOfferingId is not a service of this business");
    }

    const data = {
      basis: input.basis,
      ratePercent: input.basis === "PERCENT_OF_SERVICE_PRICE" ? new Prisma.Decimal(input.ratePercent!) : null,
      fixedAmount: input.basis === "FIXED_PER_APPOINTMENT" ? new Prisma.Decimal(input.fixedAmount!) : null,
      fixedCurrency: input.basis === "FIXED_PER_APPOINTMENT" ? input.fixedCurrency! : null,
      active: input.active ?? true,
    };

    const existing = await tx.memberCommissionRule.findFirst({ where: { businessId, businessMemberId: input.businessMemberId, serviceOfferingId }, select: { id: true } });
    const row = existing
      ? await tx.memberCommissionRule.update({ where: { id: existing.id }, data, include: ruleInclude })
      : await tx.memberCommissionRule.create({ data: { businessId, businessMemberId: input.businessMemberId, serviceOfferingId, createdByUserId: actorId, ...data }, include: ruleInclude });
    return serializeRule(row);
  }, { isolationLevel: "Serializable" });
}

export async function deleteCommissionRule(businessId: string, id: string) {
  const deleted = await prisma.memberCommissionRule.deleteMany({ where: { id, businessId } });
  if (!deleted.count) throw ApiError.notFound("Commission rule not found");
}

export async function getCommissionReport(businessId: string, query: CommissionReportQuery) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { currency: true } });
  if (!business) throw ApiError.notFound("Business not found");
  const currency = business.currency ?? "USD";
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 24 * 60 * 60_000);

  const [rules, appointments, members] = await Promise.all([
    prisma.memberCommissionRule.findMany({ where: { businessId, active: true }, select: { businessMemberId: true, serviceOfferingId: true, basis: true, ratePercent: true, fixedAmount: true, fixedCurrency: true, active: true } }),
    prisma.appointment.findMany({ where: { businessId, status: "COMPLETED", assignedMemberId: { not: null }, price: { not: null }, startsAt: { gte: from, lt: to } }, select: { id: true, assignedMemberId: true, serviceOfferingId: true, price: true } }),
    prisma.businessMember.findMany({ where: { businessId, status: "ACTIVE" }, select: { id: true, user: { select: { fullName: true } } } }),
  ]);

  return {
    from: query.from,
    to: query.to,
    currency,
    ...computeCommissionReport({
      rules,
      appointments: appointments.map(a => ({ ...a, currency })),
      members: members.map(m => ({ businessMemberId: m.id, name: m.user.fullName })),
    }),
  };
}
