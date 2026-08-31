import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { recordCustomerActivity } from "../customer/customerContext.js";
import { ensureListing, buildShareUrl } from "./discovery.js";
import { mapIndustryToCategory } from "./categories.js";

// PROGRAM 2 LOOP 2: customer marketplace actions — favourites (reusing the
// LOOP 1 CustomerBusinessLink), recently viewed, follow (foundation),
// report, and recent searches.

async function resolveDiscoverableBusiness(slug: string) {
  const business = await prisma.business.findFirst({
    where: { publicSlug: slug, platformStatus: "ACTIVE" },
    select: { id: true, name: true, industry: true, verifiedAt: true, marketplaceListing: { select: { listed: true, discoverable: true } } },
  });
  if (!business) throw ApiError.notFound("Business not found");
  const listing = business.marketplaceListing;
  if (listing && (!listing.listed || !listing.discoverable)) throw ApiError.notFound("Business not found");
  return business;
}

export async function recordBusinessView(customerProfileId: string, slug: string) {
  const business = await resolveDiscoverableBusiness(slug);
  const now = new Date();
  await prisma.$transaction([
    prisma.customerBusinessView.upsert({
      where: { customerProfileId_businessId: { customerProfileId, businessId: business.id } },
      create: { customerProfileId, businessId: business.id, viewedAt: now },
      update: { viewedAt: now, viewCount: { increment: 1 } },
    }),
    prisma.businessMarketplaceListing.upsert({
      where: { businessId: business.id },
      create: { businessId: business.id, viewCount: 1, lastListedAt: now },
      update: { viewCount: { increment: 1 } },
    }),
  ]);
}

export async function recentlyViewed(customerProfileId: string, limit = 20) {
  const views = await prisma.customerBusinessView.findMany({
    where: { customerProfileId },
    orderBy: { viewedAt: "desc" },
    take: Math.min(limit, 50),
  });
  return enrich(views.map((view) => view.businessId), views);
}

export async function toggleFavourite(customerProfileId: string, slug: string, favourite: boolean) {
  const business = await resolveDiscoverableBusiness(slug);
  const now = new Date();
  const link = await prisma.customerBusinessLink.upsert({
    where: { customerProfileId_businessId: { customerProfileId, businessId: business.id } },
    create: { customerProfileId, businessId: business.id, favourite, firstInteractionAt: now, lastInteractionAt: now },
    update: { favourite, lastInteractionAt: now },
  });
  const listing = await ensureListing(business.id);
  const favouriteCount = await prisma.customerBusinessLink.count({ where: { businessId: business.id, favourite: true } });
  await prisma.businessMarketplaceListing.update({ where: { id: listing.id }, data: { favouriteCount } });
  await recordCustomerActivity({ customerProfileId, businessId: business.id, type: favourite ? "BUSINESS_FAVOURITED" : "BUSINESS_UNFAVOURITED", entityType: "business", entityId: business.id });
  return { ...link, favouriteCount };
}

export async function toggleFollow(customerProfileId: string, slug: string, follow: boolean) {
  const business = await resolveDiscoverableBusiness(slug);
  if (follow) {
    await prisma.businessFollow.upsert({
      where: { customerProfileId_businessId: { customerProfileId, businessId: business.id } },
      create: { customerProfileId, businessId: business.id },
      update: {},
    });
  } else {
    await prisma.businessFollow.deleteMany({ where: { customerProfileId, businessId: business.id } });
  }
  const followerCount = await prisma.businessFollow.count({ where: { businessId: business.id } });
  const listing = await ensureListing(business.id);
  await prisma.businessMarketplaceListing.update({ where: { id: listing.id }, data: { followerCount } });
  await recordCustomerActivity({ customerProfileId, businessId: business.id, type: follow ? "BUSINESS_FOLLOWED" : "BUSINESS_UNFOLLOWED", entityType: "business", entityId: business.id });
  return { following: follow, followerCount };
}

export async function listFollowing(customerProfileId: string) {
  const follows = await prisma.businessFollow.findMany({ where: { customerProfileId }, orderBy: { createdAt: "desc" }, take: 100 });
  return enrich(follows.map((follow) => follow.businessId));
}

export async function listFavourites(customerProfileId: string) {
  const links = await prisma.customerBusinessLink.findMany({ where: { customerProfileId, favourite: true }, orderBy: { lastInteractionAt: "desc" }, take: 100 });
  return enrich(links.map((link) => link.businessId));
}

export async function reportBusiness(input: { customerProfileId: string; slug: string; reason: string; detail?: string }) {
  const business = await prisma.business.findFirst({ where: { publicSlug: input.slug }, select: { id: true } });
  if (!business) throw ApiError.notFound("Business not found");
  const report = await prisma.businessReport.create({
    data: { customerProfileId: input.customerProfileId, businessId: business.id, reason: input.reason, detail: input.detail ?? null },
  });
  await recordCustomerActivity({ customerProfileId: input.customerProfileId, businessId: business.id, type: "BUSINESS_REPORTED", entityType: "business", entityId: business.id, metadata: { reason: input.reason } });
  return { id: report.id, status: report.status };
}

export async function shareBusiness(customerProfileId: string, slug: string) {
  const business = await resolveDiscoverableBusiness(slug);
  await recordCustomerActivity({ customerProfileId, businessId: business.id, type: "BUSINESS_SHARED", entityType: "business", entityId: business.id });
  return { name: business.name, shareUrl: buildShareUrl(slug), message: `Check out ${business.name} on Chakusa: ${buildShareUrl(slug)}` };
}

export async function recordSearch(customerProfileId: string, query: string, resultCount: number) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  await prisma.customerRecentSearch.create({ data: { customerProfileId, query: trimmed, resultCount } });
  // keep only the last 20
  const stale = await prisma.customerRecentSearch.findMany({ where: { customerProfileId }, orderBy: { createdAt: "desc" }, skip: 20, select: { id: true } });
  if (stale.length) await prisma.customerRecentSearch.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
}

export async function recentSearches(customerProfileId: string, limit = 10) {
  const rows = await prisma.customerRecentSearch.findMany({ where: { customerProfileId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 20) });
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function enrich(businessIds: string[], viewRows?: Array<{ businessId: string; viewedAt: Date }>): Promise<Array<Record<string, unknown>>> {
  if (!businessIds.length) return [];
  const [businesses, ratings] = await Promise.all([
    prisma.business.findMany({ where: { id: { in: businessIds }, platformStatus: "ACTIVE" }, include: { marketplaceListing: true } }),
    prisma.feedback.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds } }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const ratingBy = new Map(ratings.map((row) => [row.businessId, { average: row._avg.rating ? Number(row._avg.rating.toFixed(2)) : null, count: row._count._all }]));
  const viewedBy = new Map((viewRows ?? []).map((row) => [row.businessId, row.viewedAt]));
  const byId = new Map(businesses.map((business) => [business.id, business]));
  return businessIds
    .map((id) => byId.get(id))
    .filter((business): business is NonNullable<typeof business> => Boolean(business))
    .map((business) => ({
      slug: business.publicSlug,
      name: business.name,
      category: business.marketplaceListing?.categorySlug ?? mapIndustryToCategory(business.industry),
      tagline: business.marketplaceListing?.shortTagline ?? null,
      city: business.marketplaceListing?.city ?? null,
      photo: Array.isArray(business.marketplaceListing?.photos) && business.marketplaceListing.photos.length ? String(business.marketplaceListing.photos[0]) : null,
      verified: Boolean(business.verifiedAt),
      rating: ratingBy.get(business.id)?.average ?? null,
      reviewCount: ratingBy.get(business.id)?.count ?? 0,
      ...(viewedBy.has(business.id) ? { viewedAt: viewedBy.get(business.id) } : {}),
    }));
}

export async function activePromotions(limit = 30) {
  const promotions = await prisma.marketplacePromotion.findMany({
    where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }], business: { platformStatus: "ACTIVE", publicSlug: { not: null } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 50),
    include: { business: { select: { name: true, publicSlug: true, verifiedAt: true, industry: true, marketplaceListing: { select: { categorySlug: true, city: true } } } } },
  });
  return promotions.map((promotion) => ({
    id: promotion.id,
    title: promotion.title,
    description: promotion.description,
    badge: promotion.badge,
    endsAt: promotion.endsAt,
    business: {
      slug: promotion.business.publicSlug,
      name: promotion.business.name,
      verified: Boolean(promotion.business.verifiedAt),
      category: promotion.business.marketplaceListing?.categorySlug ?? mapIndustryToCategory(promotion.business.industry),
      city: promotion.business.marketplaceListing?.city ?? null,
    },
  }));
}
