import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { config } from "../config.js";
import { mapIndustryToCategory } from "./categories.js";

// PROGRAM 2 LOOP 2: business discovery. Reads `Business` / `ServiceOffering` /
// `Feedback` / `BusinessMember` directly; `BusinessMarketplaceListing` is
// optional enrichment. NO booking, NO availability.

export const DISCOVERY_MODES = ["browse", "featured", "recent", "popular", "verified", "nearby"] as const;
export type DiscoveryMode = (typeof DISCOVERY_MODES)[number];

const CARD_INCLUDE = {
  marketplaceListing: true,
} satisfies Prisma.BusinessInclude;

type BusinessWithListing = Prisma.BusinessGetPayload<{ include: typeof CARD_INCLUDE }>;

async function ratingSummaries(businessIds: string[]) {
  if (!businessIds.length) return new Map<string, { average: number | null; count: number }>();
  const rows = await prisma.feedback.groupBy({
    by: ["businessId"],
    where: { businessId: { in: businessIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.businessId, { average: row._avg.rating ? Number(row._avg.rating.toFixed(2)) : null, count: row._count._all }]));
}

function serializeCard(business: BusinessWithListing, rating: { average: number | null; count: number } | undefined) {
  const listing = business.marketplaceListing;
  return {
    slug: business.publicSlug,
    name: business.name,
    category: listing?.categorySlug ?? mapIndustryToCategory(business.industry),
    subcategory: listing?.subcategorySlug ?? null,
    industry: business.industry,
    tagline: listing?.shortTagline ?? null,
    city: listing?.city ?? null,
    region: listing?.region ?? null,
    photo: Array.isArray(listing?.photos) && listing.photos.length ? String(listing.photos[0]) : null,
    verified: Boolean(business.verifiedAt),
    featured: Boolean(listing?.featured && (!listing.featuredUntil || listing.featuredUntil > new Date())),
    rating: rating?.average ?? null,
    reviewCount: rating?.count ?? 0,
    viewCount: listing?.viewCount ?? 0,
    favouriteCount: listing?.favouriteCount ?? 0,
    createdAt: business.createdAt,
  };
}

interface DiscoverInput {
  mode?: DiscoveryMode;
  categorySlug?: string;
  query?: string;
  city?: string;
  verifiedOnly?: boolean;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  limit?: number;
  cursor?: string;
}

function baseWhere(input: DiscoverInput): Prisma.BusinessWhereInput {
  const where: Prisma.BusinessWhereInput = {
    platformStatus: "ACTIVE",
    publicSlug: { not: null },
    OR: [{ marketplaceListing: null }, { marketplaceListing: { listed: true, discoverable: true } }],
  };
  if (input.verifiedOnly || input.mode === "verified") where.verifiedAt = { not: null };
  if (input.query) {
    where.AND = [
      {
        OR: [
          { name: { contains: input.query, mode: "insensitive" } },
          { industry: { contains: input.query, mode: "insensitive" } },
          { description: { contains: input.query, mode: "insensitive" } },
          { marketplaceListing: { shortTagline: { contains: input.query, mode: "insensitive" } } },
          { marketplaceListing: { city: { contains: input.query, mode: "insensitive" } } },
          { serviceOfferings: { some: { active: true, name: { contains: input.query, mode: "insensitive" } } } },
        ],
      },
    ];
  }
  if (input.city) {
    where.marketplaceListing = { ...(where.marketplaceListing as object), city: { contains: input.city, mode: "insensitive" } };
  }
  if (input.categorySlug) {
    where.OR = [
      { marketplaceListing: { listed: true, discoverable: true, categorySlug: input.categorySlug } },
      // Businesses with no listing whose mapped industry matches — resolved
      // in-memory below since Prisma cannot express the mapping.
      { marketplaceListing: null },
    ];
  }
  if (input.mode === "nearby" && typeof input.lat === "number" && typeof input.lng === "number") {
    const radius = input.radiusKm ?? 15;
    const dLat = radius / 111;
    const dLng = radius / (111 * Math.max(0.2, Math.cos((input.lat * Math.PI) / 180)));
    where.marketplaceListing = {
      ...(where.marketplaceListing as object),
      latitude: { gte: input.lat - dLat, lte: input.lat + dLat },
      longitude: { gte: input.lng - dLng, lte: input.lng + dLng },
    };
  }
  return where;
}

function orderFor(mode: DiscoveryMode | undefined): Prisma.BusinessOrderByWithRelationInput[] {
  switch (mode) {
    case "featured":
      return [{ marketplaceListing: { featuredRank: "asc" } }, { name: "asc" }];
    case "recent":
      return [{ createdAt: "desc" }];
    case "popular":
      return [{ marketplaceListing: { favouriteCount: "desc" } }, { marketplaceListing: { viewCount: "desc" } }, { name: "asc" }];
    case "verified":
      return [{ verifiedAt: "desc" }];
    default:
      return [{ name: "asc" }];
  }
}

export async function discoverBusinesses(input: DiscoverInput) {
  const limit = Math.min(input.limit ?? 20, 50);
  const where = baseWhere(input);
  if (input.mode === "featured") {
    where.marketplaceListing = { ...(where.marketplaceListing as object), listed: true, discoverable: true, featured: true, OR: [{ featuredUntil: null }, { featuredUntil: { gt: new Date() } }] };
    delete where.OR;
  }
  if (input.mode === "popular") {
    // Popularity is measured by listing counters; a business with no listing
    // row has no engagement signal. Requiring the listing also keeps NULLs
    // out of the `favouriteCount` ordering.
    where.marketplaceListing = { ...(where.marketplaceListing as object), listed: true, discoverable: true };
    delete where.OR;
  }

  const rows = await prisma.business.findMany({
    where,
    include: CARD_INCLUDE,
    orderBy: orderFor(input.mode),
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  let filtered = rows;
  if (input.categorySlug) {
    filtered = rows.filter((business) => (business.marketplaceListing?.categorySlug ?? mapIndustryToCategory(business.industry)) === input.categorySlug);
  }
  const page = filtered.slice(0, limit);
  const ratings = await ratingSummaries(page.map((business) => business.id));
  return {
    items: page.map((business) => serializeCard(business, ratings.get(business.id))),
    nextCursor: filtered.length > limit ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function searchSuggestions(prefix: string, limit = 8) {
  const clean = prefix.trim();
  if (clean.length < 2) return { businesses: [], categories: [] };
  const [businesses, categories] = await Promise.all([
    prisma.business.findMany({
      where: { platformStatus: "ACTIVE", publicSlug: { not: null }, name: { contains: clean, mode: "insensitive" }, OR: [{ marketplaceListing: null }, { marketplaceListing: { listed: true, discoverable: true } }] },
      select: { name: true, publicSlug: true },
      take: limit,
    }),
    prisma.marketplaceCategory.findMany({ where: { active: true, name: { contains: clean, mode: "insensitive" } }, select: { slug: true, name: true, icon: true }, take: 5 }),
  ]);
  return { businesses, categories };
}

/** Full customer-facing profile. Records a view when `customerProfileId` is present. NO booking data. */
export async function getMarketplaceBusinessProfile(slug: string, viewer?: { customerProfileId?: string }) {
  const business = await prisma.business.findFirst({
    where: { publicSlug: slug, platformStatus: "ACTIVE" },
    include: {
      marketplaceListing: true,
      serviceOfferings: { where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, description: true, category: true, durationMinutes: true, price: true, depositAmount: true, publiclyBookable: true } },
      members: { where: { status: "ACTIVE" }, select: { role: true, user: { select: { fullName: true } } }, orderBy: { createdAt: "asc" }, take: 30 },
      marketplacePromotions: { where: { active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!business) throw ApiError.notFound("Business not found");
  const listing = business.marketplaceListing;
  if (listing && (!listing.listed || !listing.discoverable)) throw ApiError.notFound("Business not found");

  const [ratingRow, recentReviews] = await Promise.all([
    prisma.feedback.aggregate({ where: { businessId: business.id }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.feedback.findMany({ where: { businessId: business.id, comment: { not: null } }, orderBy: { createdAt: "desc" }, take: 5, select: { rating: true, comment: true, createdAt: true, sentiment: true } }),
  ]);

  let favourite = false;
  let following = false;
  if (viewer?.customerProfileId) {
    const [link, follow] = await Promise.all([
      prisma.customerBusinessLink.findUnique({ where: { customerProfileId_businessId: { customerProfileId: viewer.customerProfileId, businessId: business.id } }, select: { favourite: true } }),
      prisma.businessFollow.findUnique({ where: { customerProfileId_businessId: { customerProfileId: viewer.customerProfileId, businessId: business.id } }, select: { id: true } }),
    ]);
    favourite = Boolean(link?.favourite);
    following = Boolean(follow);
  }

  return {
    slug: business.publicSlug,
    name: business.name,
    about: business.description,
    category: listing?.categorySlug ?? mapIndustryToCategory(business.industry),
    industry: business.industry,
    tagline: listing?.shortTagline ?? null,
    verified: Boolean(business.verifiedAt),
    contact: { phone: business.phone },
    address: { line: listing?.addressLine ?? null, city: listing?.city ?? null, region: listing?.region ?? null, country: business.country, latitude: listing?.latitude ?? null, longitude: listing?.longitude ?? null },
    openingHours: (business.workingHours as unknown) ?? null,
    photos: (listing?.photos as string[] | null) ?? [],
    socialLinks: (listing?.socialLinks as Record<string, string> | null) ?? {},
    services: business.serviceOfferings.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      category: service.category,
      durationMinutes: service.durationMinutes,
      price: service.price ? Number(service.price) : null,
      depositAmount: service.depositAmount ? Number(service.depositAmount) : null,
      bookable: service.publiclyBookable, // informational only — booking is a later loop
    })),
    team: business.members.map((member) => ({ name: member.user.fullName, role: member.role })),
    promotions: business.marketplacePromotions.map((promotion) => ({ id: promotion.id, title: promotion.title, description: promotion.description, badge: promotion.badge, endsAt: promotion.endsAt })),
    reviewsSummary: {
      averageRating: ratingRow._avg.rating ? Number(ratingRow._avg.rating.toFixed(2)) : null,
      totalReviews: ratingRow._count._all,
      recent: recentReviews.map((review) => ({ rating: review.rating, comment: review.comment, sentiment: review.sentiment, createdAt: review.createdAt })),
    },
    viewer: { favourite, following },
    shareUrl: buildShareUrl(business.publicSlug!),
    businessId: business.id,
  };
}

export function buildShareUrl(slug: string): string {
  const base = config.PUBLIC_REVIEW_BASE_URL?.replace(/\/$/, "") ?? "https://chakusa.app";
  return `${base}/b/${slug}`;
}

/** Lazily creates the listing row so counters/curation have somewhere to live. */
export async function ensureListing(businessId: string) {
  return prisma.businessMarketplaceListing.upsert({
    where: { businessId },
    create: { businessId, lastListedAt: new Date() },
    update: {},
  });
}
