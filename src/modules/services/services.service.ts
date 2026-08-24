import { Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { CreateServiceOfferingInput, UpdateServiceOfferingInput } from "./services.schemas.js";

const include = { assignments: { include: { businessMember: { include: { user: { select: { id: true, fullName: true, email: true } } } } } } } as const;

async function validateMembers(tx: Prisma.TransactionClient, businessId: string, memberIds: string[]) {
  if (!memberIds.length) return;
  const unique = [...new Set(memberIds)];
  const count = await tx.businessMember.count({ where: { id: { in: unique }, businessId, status: "ACTIVE" } });
  if (count !== unique.length) throw ApiError.badRequest("Every assigned member must be active in this business");
}

async function syncLegacyServiceNames(tx: Prisma.TransactionClient, businessId: string) {
  const services = await tx.serviceOffering.findMany({ where: { businessId, active: true }, select: { name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  await tx.business.update({ where: { id: businessId }, data: { defaultServices: services.map(service => service.name) } });
}

function translateUniqueName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw ApiError.conflict("A service with this name already exists");
  throw error;
}

export function listServiceOfferings(businessId: string, active?: boolean) {
  return prisma.serviceOffering.findMany({ where: { businessId, active }, include, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function getServiceOffering(businessId: string, id: string) {
  const service = await prisma.serviceOffering.findFirst({ where: { id, businessId }, include });
  if (!service) throw ApiError.notFound("Service not found");
  return service;
}

export async function createServiceOffering(businessId: string, input: CreateServiceOfferingInput) {
  const { memberIds, ...data } = input;
  try {
    return await prisma.$transaction(async tx => {
      await validateMembers(tx, businessId, memberIds);
      const service = await tx.serviceOffering.create({ data: { businessId, ...data, assignments: memberIds.length ? { create: [...new Set(memberIds)].map(businessMemberId => ({ businessMemberId })) } : undefined }, include });
      await syncLegacyServiceNames(tx, businessId);
      return service;
    });
  } catch (error) { return translateUniqueName(error); }
}

export async function updateServiceOffering(businessId: string, id: string, input: UpdateServiceOfferingInput) {
  const { memberIds, ...data } = input;
  try {
    return await prisma.$transaction(async tx => {
      const current = await tx.serviceOffering.findFirst({ where: { id, businessId } });
      if (!current) throw ApiError.notFound("Service not found");
      const effectivePrice = data.price === undefined ? (current.price == null ? null : Number(current.price)) : data.price;
      const effectiveDeposit = data.depositAmount === undefined ? (current.depositAmount == null ? null : Number(current.depositAmount)) : data.depositAmount;
      if (effectiveDeposit != null && (effectivePrice == null || effectiveDeposit > effectivePrice)) throw ApiError.badRequest("depositAmount requires a price and cannot exceed it");
      if (memberIds) await validateMembers(tx, businessId, memberIds);
      if (memberIds) { await tx.serviceMemberAssignment.deleteMany({ where: { serviceOfferingId: id } }); await tx.serviceMemberAssignment.createMany({ data: [...new Set(memberIds)].map(businessMemberId => ({ serviceOfferingId: id, businessMemberId })) }); }
      const service = await tx.serviceOffering.update({ where: { id }, data, include });
      await syncLegacyServiceNames(tx, businessId);
      return service;
    });
  } catch (error) { return translateUniqueName(error); }
}

export async function archiveServiceOffering(businessId: string, id: string) {
  return updateServiceOffering(businessId, id, { active: false, publiclyBookable: false });
}

export async function syncServiceOfferingsFromLegacyNames(businessId: string, names: string[]) {
  const normalized = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  await prisma.$transaction(async tx => {
    for (const [sortOrder, name] of normalized.entries()) {
      await tx.serviceOffering.upsert({ where: { businessId_name: { businessId, name } }, create: { businessId, name, durationMinutes: 60, sortOrder }, update: { active: true, sortOrder } });
    }
    await tx.serviceOffering.updateMany({ where: { businessId, name: { notIn: normalized } }, data: { active: false, publiclyBookable: false } });
  });
}
