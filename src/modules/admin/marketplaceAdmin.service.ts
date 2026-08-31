import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { ensureListing } from "../../lib/marketplace/discovery.js";
import { mapIndustryToCategory, refreshCategoryCounts, seedMarketplaceCategories } from "../../lib/marketplace/categories.js";

// PROGRAM 2 LOOP 2: platform-wide marketplace administration. Reuses the
// admin router's authenticateAdmin + requireAdminPermission + CSRF + audit.

function page(p = 1, size = 25) {
  return { skip: (Math.max(1, p) - 1) * Math.min(100, Math.max(1, size)), take: Math.min(100, Math.max(1, size)), page: Math.max(1, p), pageSize: Math.min(100, Math.max(1, size)) };
}

export async function adminListListings(query: { search?: string; featured?: boolean; page?: number; pageSize?: number }) {
  const { skip, take, page: p, pageSize } = page(query.page, query.pageSize);
  const where: Prisma.BusinessWhereInput = {
    publicSlug: { not: null },
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
    ...(query.featured ? { marketplaceListing: { featured: true } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.business.findMany({
      where,
      orderBy: [{ marketplaceListing: { featured: "desc" } }, { createdAt: "desc" }],
      skip,
      take,
      select: {
        id: true,
        name: true,
        industry: true,
        verifiedAt: true,
        platformStatus: true,
        publicSlug: true,
        createdAt: true,
        marketplaceListing: true,
      },
    }),
    prisma.business.count({ where }),
  ]);
  return {
    items: items.map((business) => ({
      businessId: business.id,
      name: business.name,
      slug: business.publicSlug,
      industry: business.industry,
      verified: Boolean(business.verifiedAt),
      platformStatus: business.platformStatus,
      category: business.marketplaceListing?.categorySlug ?? mapIndustryToCategory(business.industry),
      listing: business.marketplaceListing,
    })),
    total,
    page: p,
    pageSize,
  };
}

export async function adminGetListing(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, industry: true, verifiedAt: true, platformStatus: true, publicSlug: true, description: true, phone: true, country: true, marketplaceListing: true, marketplacePromotions: { orderBy: { createdAt: "desc" } } },
  });
  if (!business) throw ApiError.notFound("Business not found");
  return { ...business, category: business.marketplaceListing?.categorySlug ?? mapIndustryToCategory(business.industry) };
}

export async function adminUpdateListing(businessId: string, patch: {
  listed?: boolean;
  discoverable?: boolean;
  featured?: boolean;
  featuredRank?: number | null;
  featuredUntil?: string | null;
  categorySlug?: string | null;
  subcategorySlug?: string | null;
  shortTagline?: string | null;
  photos?: string[] | null;
  socialLinks?: Record<string, string> | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!business) throw ApiError.notFound("Business not found");
  if (patch.categorySlug) {
    const category = await prisma.marketplaceCategory.findUnique({ where: { slug: patch.categorySlug }, select: { id: true } });
    if (!category) throw ApiError.badRequest("Unknown category slug");
  }
  await ensureListing(businessId);
  const data: Prisma.BusinessMarketplaceListingUpdateInput = {};
  for (const key of ["listed", "discoverable", "featured", "featuredRank", "categorySlug", "subcategorySlug", "shortTagline", "addressLine", "city", "region", "latitude", "longitude"] as const) {
    if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.featuredUntil !== undefined) data.featuredUntil = patch.featuredUntil ? new Date(patch.featuredUntil) : null;
  if (patch.photos !== undefined) data.photos = (patch.photos ?? undefined) as Prisma.InputJsonValue | undefined;
  if (patch.socialLinks !== undefined) data.socialLinks = (patch.socialLinks ?? undefined) as Prisma.InputJsonValue | undefined;
  const updated = await prisma.businessMarketplaceListing.update({ where: { businessId }, data });
  await refreshCategoryCounts().catch(() => undefined);
  return updated;
}

// --- Categories ---

export async function adminListCategories() {
  return prisma.marketplaceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function adminUpsertCategory(input: { slug: string; name: string; icon?: string; description?: string; parentSlug?: string | null; sortOrder?: number; trending?: boolean; active?: boolean }) {
  const parent = input.parentSlug ? await prisma.marketplaceCategory.findUnique({ where: { slug: input.parentSlug }, select: { id: true } }) : null;
  if (input.parentSlug && !parent) throw ApiError.badRequest("Unknown parent category");
  return prisma.marketplaceCategory.upsert({
    where: { slug: input.slug },
    create: { slug: input.slug, name: input.name, icon: input.icon ?? null, description: input.description ?? null, parentId: parent?.id ?? null, sortOrder: input.sortOrder ?? 100, trending: input.trending ?? false, active: input.active ?? true },
    update: { name: input.name, icon: input.icon ?? undefined, description: input.description ?? undefined, parentId: input.parentSlug !== undefined ? parent?.id ?? null : undefined, sortOrder: input.sortOrder, trending: input.trending, active: input.active },
  });
}

export async function adminDeleteCategory(slug: string) {
  await prisma.marketplaceCategory.updateMany({ where: { slug }, data: { active: false } });
  return { deactivated: slug };
}

export async function adminSeedCategories() {
  return { categories: await seedMarketplaceCategories() };
}

export async function adminRefreshCategoryCounts() {
  return refreshCategoryCounts();
}

// --- Promotions ---

export async function adminListPromotions(query: { businessId?: string; activeOnly?: boolean }) {
  return prisma.marketplacePromotion.findMany({
    where: { ...(query.businessId ? { businessId: query.businessId } : {}), ...(query.activeOnly ? { active: true } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { business: { select: { name: true, publicSlug: true } } },
  });
}

export async function adminCreatePromotion(input: { businessId: string; title: string; description?: string; badge?: string; startsAt?: string; endsAt?: string; createdByUserId?: string }) {
  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { id: true } });
  if (!business) throw ApiError.notFound("Business not found");
  return prisma.marketplacePromotion.create({
    data: {
      businessId: input.businessId,
      title: input.title,
      description: input.description ?? null,
      badge: input.badge ?? null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export async function adminUpdatePromotion(id: string, patch: { title?: string; description?: string | null; badge?: string | null; endsAt?: string | null; active?: boolean }) {
  const existing = await prisma.marketplacePromotion.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Promotion not found");
  return prisma.marketplacePromotion.update({
    where: { id },
    data: {
      title: patch.title,
      description: patch.description === undefined ? undefined : patch.description,
      badge: patch.badge === undefined ? undefined : patch.badge,
      endsAt: patch.endsAt === undefined ? undefined : patch.endsAt ? new Date(patch.endsAt) : null,
      active: patch.active,
    },
  });
}

export async function adminDeletePromotion(id: string) {
  const deleted = await prisma.marketplacePromotion.deleteMany({ where: { id } });
  if (!deleted.count) throw ApiError.notFound("Promotion not found");
}

// --- Reports ---

export async function adminListReports(query: { status?: string }) {
  const reports = await prisma.businessReport.findMany({
    where: query.status ? { status: query.status } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const businessIds = [...new Set(reports.map((report) => report.businessId))];
  const businesses = businessIds.length ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }) : [];
  const byId = new Map(businesses.map((business) => [business.id, business]));
  return reports.map((report) => ({ ...report, business: byId.get(report.businessId) ?? null }));
}

export async function adminResolveReport(id: string, status: "REVIEWING" | "RESOLVED" | "DISMISSED", resolvedByUserId?: string) {
  const existing = await prisma.businessReport.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Report not found");
  return prisma.businessReport.update({
    where: { id },
    data: { status, resolvedByUserId: resolvedByUserId ?? null, resolvedAt: status === "RESOLVED" || status === "DISMISSED" ? new Date() : null },
  });
}

// --- Analytics ---

export async function adminMarketplaceAnalytics() {
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const [listedTotal, featuredTotal, promoTotal, reportsOpen, categoryCounts, topViewed, topFavourited, searches7, viewsTotal] = await Promise.all([
    prisma.business.count({ where: { publicSlug: { not: null }, platformStatus: "ACTIVE", OR: [{ marketplaceListing: null }, { marketplaceListing: { listed: true, discoverable: true } }] } }),
    prisma.businessMarketplaceListing.count({ where: { featured: true } }),
    prisma.marketplacePromotion.count({ where: { active: true } }),
    prisma.businessReport.count({ where: { status: "OPEN" } }),
    prisma.marketplaceCategory.findMany({ where: { active: true }, select: { slug: true, name: true, businessCount: true }, orderBy: { businessCount: "desc" }, take: 15 }),
    prisma.businessMarketplaceListing.findMany({ orderBy: { viewCount: "desc" }, take: 10, select: { businessId: true, viewCount: true, favouriteCount: true } }),
    prisma.businessMarketplaceListing.findMany({ orderBy: { favouriteCount: "desc" }, take: 10, select: { businessId: true, favouriteCount: true, viewCount: true } }),
    prisma.customerRecentSearch.count({ where: { createdAt: { gte: since7 } } }),
    prisma.businessMarketplaceListing.aggregate({ _sum: { viewCount: true, favouriteCount: true } }),
  ]);
  const businessIds = [...new Set([...topViewed, ...topFavourited].map((row) => row.businessId))];
  const names = businessIds.length ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }) : [];
  const nameBy = new Map(names.map((business) => [business.id, business]));
  const withName = (rows: Array<{ businessId: string; viewCount: number; favouriteCount: number }>) =>
    rows.map((row) => ({ ...row, business: nameBy.get(row.businessId) ?? null }));
  return {
    listedBusinesses: listedTotal,
    featuredBusinesses: featuredTotal,
    activePromotions: promoTotal,
    openReports: reportsOpen,
    totalViews: viewsTotal._sum.viewCount ?? 0,
    totalFavourites: viewsTotal._sum.favouriteCount ?? 0,
    searchesLast7Days: searches7,
    businessesByCategory: categoryCounts,
    topViewed: withName(topViewed),
    topFavourited: withName(topFavourited),
  };
}
