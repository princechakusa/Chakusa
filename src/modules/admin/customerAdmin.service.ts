import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

// PROGRAM 2 LOOP 1: platform-wide (cross-tenant) customer administration.
// Reuses the admin router's authenticateAdmin + requireAdminPermission +
// recordAdminAudit. All reads are `customer.read`; status/verify are
// `customer.manage`.

function pageArgs(page = 1, pageSize = 25) {
  const p = Math.max(1, page);
  const size = Math.min(100, Math.max(1, pageSize));
  return { skip: (p - 1) * size, take: size, page: p, pageSize: size };
}

export async function listAdminCustomers(query: { search?: string; status?: string; page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where: Prisma.CustomerProfileWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { displayName: { contains: query.search, mode: "insensitive" } },
            { phoneE164: { contains: query.search } },
            { user: { normalizedEmail: { contains: query.search.toLowerCase() } } },
            { user: { fullName: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.customerProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        displayName: true,
        status: true,
        preferredLanguage: true,
        verifiedAt: true,
        lastSeenAt: true,
        createdAt: true,
        user: { select: { email: true, fullName: true, emailVerifiedAt: true, accountStatus: true } },
        _count: { select: { businessLinks: true } },
      },
    }),
    prisma.customerProfile.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getAdminCustomer(id: string) {
  const profile = await prisma.customerProfile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, fullName: true, emailVerifiedAt: true, accountStatus: true, createdAt: true, authIdentities: { select: { provider: true, providerEmail: true } } } },
      businessLinks: { orderBy: { lastInteractionAt: "desc" }, take: 100 },
      notifications: { orderBy: { createdAt: "desc" }, take: 20 },
      activity: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!profile) throw ApiError.notFound("Customer not found");
  const [sessionCount, deviceCount] = await Promise.all([
    prisma.authSession.count({ where: { userId: profile.user.id, scope: "CUSTOMER", revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.deviceToken.count({ where: { userId: profile.user.id, isActive: true } }),
  ]);
  return { ...profile, activeSessions: sessionCount, activeDevices: deviceCount };
}

export async function setAdminCustomerStatus(id: string, status: "ACTIVE" | "SUSPENDED" | "DELETED", reason?: string) {
  const profile = await prisma.customerProfile.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!profile) throw ApiError.notFound("Customer not found");
  const updated = await prisma.customerProfile.update({ where: { id }, data: { status } });
  if (status !== "ACTIVE") {
    await prisma.authSession.updateMany({
      where: { userId: profile.userId, scope: "CUSTOMER", revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason ?? `admin_${status.toLowerCase()}` },
    });
  }
  return { previousStatus: profile.status, ...updated };
}

export async function verifyAdminCustomer(id: string) {
  const profile = await prisma.customerProfile.findUnique({ where: { id }, select: { userId: true } });
  if (!profile) throw ApiError.notFound("Customer not found");
  const now = new Date();
  await prisma.$transaction([
    prisma.customerProfile.updateMany({ where: { id, verifiedAt: null }, data: { verifiedAt: now } }),
    prisma.user.updateMany({ where: { id: profile.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } }),
  ]);
  return prisma.customerProfile.findUniqueOrThrow({ where: { id } });
}

export async function adminCustomerAnalytics() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const [total, byStatus, verified, new30, active7, withBusiness, linkTotal] = await Promise.all([
    prisma.customerProfile.count(),
    prisma.customerProfile.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.customerProfile.count({ where: { verifiedAt: { not: null } } }),
    prisma.customerProfile.count({ where: { createdAt: { gte: since30 } } }),
    prisma.customerProfile.count({ where: { lastSeenAt: { gte: since7 } } }),
    prisma.customerProfile.count({ where: { businessLinks: { some: {} } } }),
    prisma.customerBusinessLink.count(),
  ]);
  return {
    totalCustomers: total,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    verifiedCustomers: verified,
    newLast30Days: new30,
    activeLast7Days: active7,
    customersWithABusinessRelationship: withBusiness,
    totalBusinessRelationships: linkTotal,
    avgBusinessesPerCustomer: total ? Number((linkTotal / total).toFixed(2)) : 0,
  };
}
