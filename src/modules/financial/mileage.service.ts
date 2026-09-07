import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { computeMileageAmount } from "../../lib/financial/financial.domain.js";
import type { CreateMileageTripInput, ListMileageTripsQuery, UpdateMileageTripInput } from "./financial.schemas.js";

// PROGRAM 3 / Financial Management F2 (mileage). A trip's money value is
// DERIVED server-side (distance x owner-set reimbursement rate) and
// snapshotted onto `amount` so a later rate change never rewrites history.
// `ratePerUnit` is an owner reimbursement rate, never a government mileage
// allowance. Currency is required whenever a rate is given so no amount is
// ever stored without an explicit currency (money rule).

const tripSelect = {
  id: true,
  tripDate: true,
  distance: true,
  unit: true,
  ratePerUnit: true,
  amount: true,
  currency: true,
  purpose: true,
  fromLabel: true,
  toLabel: true,
  appointmentId: true,
  customerId: true,
  createdAt: true,
  updatedAt: true,
  createdByMember: { select: { id: true, user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.MileageTripSelect;

function serializeTrip(row: Prisma.MileageTripGetPayload<{ select: typeof tripSelect }>) {
  return {
    id: row.id,
    tripDate: row.tripDate,
    distance: row.distance.toFixed(2),
    unit: row.unit,
    ratePerUnit: row.ratePerUnit ? row.ratePerUnit.toFixed(4) : null,
    amount: row.amount ? row.amount.toFixed(2) : null,
    currency: row.currency,
    purpose: row.purpose,
    fromLabel: row.fromLabel,
    toLabel: row.toLabel,
    appointmentId: row.appointmentId,
    customerId: row.customerId,
    createdBy: row.createdByMember
      ? { memberId: row.createdByMember.id, name: row.createdByMember.user.fullName }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertLinksBelongToBusiness(
  businessId: string,
  links: { appointmentId?: string | null; customerId?: string | null },
): Promise<void> {
  if (links.appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: { id: links.appointmentId, businessId },
      select: { id: true },
    });
    if (!appointment) throw ApiError.badRequest("Appointment does not belong to this business");
  }
  if (links.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: links.customerId, businessId },
      select: { id: true },
    });
    if (!customer) throw ApiError.badRequest("Customer does not belong to this business");
  }
}

/** distance x rate -> { amount, currency } snapshot, or nulls when no rate. */
function resolveMoney(input: {
  distance: string | number;
  ratePerUnit?: string | number | null;
  currency?: string | null;
}): { amount: Prisma.Decimal | null; currency: string | null } {
  if (input.ratePerUnit == null) return { amount: null, currency: null };
  if (!input.currency) throw ApiError.badRequest("A currency is required when a mileage rate is set");
  const amount = computeMileageAmount({ distance: input.distance, ratePerUnit: input.ratePerUnit });
  return { amount: amount == null ? null : new Prisma.Decimal(amount), currency: input.currency };
}

export async function listMileageTrips(businessId: string, query: ListMileageTripsQuery) {
  const where: Prisma.MileageTripWhereInput = {
    businessId,
    deletedAt: null,
    ...(query.from || query.to
      ? { tripDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.mileageTrip.findMany({
      where,
      orderBy: [{ tripDate: "desc" }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: tripSelect,
    }),
    prisma.mileageTrip.count({ where }),
  ]);
  return {
    items: rows.map(serializeTrip),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getMileageTrip(businessId: string, id: string) {
  const row = await prisma.mileageTrip.findFirst({ where: { id, businessId, deletedAt: null }, select: tripSelect });
  if (!row) throw ApiError.notFound("Mileage trip not found");
  return serializeTrip(row);
}

export async function createMileageTrip(businessId: string, createdByMemberId: string, input: CreateMileageTripInput) {
  await assertLinksBelongToBusiness(businessId, input);
  const money = resolveMoney({ distance: input.distance, ratePerUnit: input.ratePerUnit, currency: input.currency });
  const row = await prisma.mileageTrip.create({
    data: {
      businessId,
      createdByMemberId,
      tripDate: input.tripDate,
      distance: new Prisma.Decimal(input.distance),
      unit: input.unit,
      ratePerUnit: input.ratePerUnit == null ? null : new Prisma.Decimal(input.ratePerUnit),
      amount: money.amount,
      currency: money.currency,
      purpose: input.purpose ?? null,
      fromLabel: input.fromLabel ?? null,
      toLabel: input.toLabel ?? null,
      appointmentId: input.appointmentId ?? null,
      customerId: input.customerId ?? null,
    },
    select: tripSelect,
  });
  return serializeTrip(row);
}

export async function updateMileageTrip(businessId: string, id: string, input: UpdateMileageTripInput) {
  const existing = await prisma.mileageTrip.findFirst({
    where: { id, businessId, deletedAt: null },
    select: { distance: true, ratePerUnit: true, currency: true },
  });
  if (!existing) throw ApiError.notFound("Mileage trip not found");
  await assertLinksBelongToBusiness(businessId, input);

  // Recompute the money snapshot from the post-update distance/rate/currency.
  const distance = input.distance ?? existing.distance.toString();
  const ratePerUnit =
    input.ratePerUnit !== undefined ? input.ratePerUnit : existing.ratePerUnit?.toString() ?? null;
  const currency = input.currency !== undefined ? input.currency : existing.currency;
  const money = resolveMoney({ distance, ratePerUnit, currency });

  const data: Prisma.MileageTripUpdateInput = {
    ratePerUnit: ratePerUnit == null ? null : new Prisma.Decimal(ratePerUnit),
    amount: money.amount,
    currency: money.currency,
  };
  if (input.tripDate !== undefined) data.tripDate = input.tripDate;
  if (input.distance !== undefined) data.distance = new Prisma.Decimal(input.distance);
  if (input.unit !== undefined) data.unit = input.unit;
  if (input.purpose !== undefined) data.purpose = input.purpose ?? null;
  if (input.fromLabel !== undefined) data.fromLabel = input.fromLabel ?? null;
  if (input.toLabel !== undefined) data.toLabel = input.toLabel ?? null;
  if (input.appointmentId !== undefined) {
    data.appointment = input.appointmentId ? { connect: { id: input.appointmentId } } : { disconnect: true };
  }
  if (input.customerId !== undefined) {
    data.customer = input.customerId ? { connect: { id: input.customerId } } : { disconnect: true };
  }

  const row = await prisma.mileageTrip.update({ where: { id }, data, select: tripSelect });
  return serializeTrip(row);
}

export async function deleteMileageTrip(businessId: string, id: string) {
  const result = await prisma.mileageTrip.updateMany({
    where: { id, businessId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count !== 1) throw ApiError.notFound("Mileage trip not found");
}
