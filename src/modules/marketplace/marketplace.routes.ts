import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DISCOVERY_MODES, discoverBusinesses, getMarketplaceBusinessProfile, searchSuggestions } from "../../lib/marketplace/discovery.js";
import { listCategories, trendingCategories } from "../../lib/marketplace/categories.js";
import { googlePlacesEnabled, nearbyGooglePlaces } from "../../lib/marketplace/googlePlaces.js";
import { nearbyOsmPlaces, OSM_ATTRIBUTION, withoutChakusaDuplicates } from "../../lib/marketplace/osmPlaces.js";
import { prisma } from "../../lib/prisma.js";
import {
  activePromotions,
  listFavourites,
  listFollowing,
  recentSearches,
  recentlyViewed,
  recordBusinessView,
  recordSearch,
  reportBusiness,
  shareBusiness,
  toggleFavourite,
  toggleFollow,
} from "../../lib/marketplace/customerMarketplace.js";

const slugParam = z.object({ slug: z.string().trim().min(1).max(200) });
const discoverQuery = z.object({
  mode: z.enum(DISCOVERY_MODES).optional(),
  category: z.string().trim().max(80).optional(),
  q: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  bookableOnly: z.coerce.boolean().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().uuid().optional(),
});

// Read-only discovery, shared by the signed-in marketplace (viewer set: records
// searches and profile views for that customer) and the public guest browsing
// routes (no viewer: records nothing, rate-limited per IP). Returns only public
// listing data either way.
type DiscoveryViewer = { profileId: (request: FastifyRequest) => string };
function registerDiscoveryReads(fastify: FastifyInstance, viewer: DiscoveryViewer | null) {
  const limited = viewer ? {} : { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };

  // --- Discovery ---
  fastify.get("/", limited, async (request) => {
    const query = discoverQuery.parse(request.query);
    return discoverBusinesses({ mode: query.mode ?? "browse", categorySlug: query.category, query: query.q, city: query.city, verifiedOnly: query.verifiedOnly, bookableOnly: query.bookableOnly, limit: query.limit, cursor: query.cursor });
  });

  fastify.get("/nearby", limited, async (request) => {
    const query = discoverQuery.parse(request.query);
    return discoverBusinesses({ mode: "nearby", lat: query.lat, lng: query.lng, radiusKm: query.radiusKm, categorySlug: query.category, query: query.q, bookableOnly: query.bookableOnly, limit: query.limit, cursor: query.cursor });
  });

  // Free: service places near the customer from OpenStreetMap that are not on
  // Chakusa yet. Safe to draw on the OSM map (ODbL, with attribution).
  fastify.get("/nearby-places", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const query = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().min(0.5).max(50).default(5), q: z.string().trim().max(120).optional() }).parse(request.query);
    const places = await nearbyOsmPlaces({ latitude: query.lat, longitude: query.lng, radiusKm: query.radiusKm, query: query.q });
    const span = 0.06;
    const listings = places.length ? await prisma.businessMarketplaceListing.findMany({
      where: { latitude: { gte: query.lat - span, lte: query.lat + span }, longitude: { gte: query.lng - span, lte: query.lng + span } },
      select: { latitude: true, longitude: true, business: { select: { name: true } } },
      take: 500,
    }) : [];
    return { attribution: OSM_ATTRIBUTION, places: withoutChakusaDuplicates(places, listings.map((l) => ({ name: l.business.name, latitude: l.latitude, longitude: l.longitude }))) };
  });

  // Places near the customer that are on Google but not (yet) on Chakusa.
  // Clients list these with Google attribution; they are never drawn on the
  // OpenStreetMap map (Google Maps Platform terms).
  fastify.get("/google-nearby", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const query = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().min(0.5).max(50).default(5), q: z.string().trim().max(120).optional() }).parse(request.query);
    if (!googlePlacesEnabled()) return { enabled: false, attribution: "Google", places: [] };
    const places = await nearbyGooglePlaces({ latitude: query.lat, longitude: query.lng, radiusKm: query.radiusKm, query: query.q });
    const linked = places.length ? await prisma.business.findMany({ where: { googlePlaceId: { in: places.map((p) => p.placeId) } }, select: { googlePlaceId: true } }) : [];
    const onChakusa = new Set(linked.map((b) => b.googlePlaceId));
    return { enabled: true, attribution: "Google", places: places.filter((p) => !onChakusa.has(p.placeId)) };
  });

  fastify.get("/featured", limited, async (request) => discoverBusinesses({ mode: "featured", limit: discoverQuery.parse(request.query).limit }));
  fastify.get("/recent", limited, async (request) => discoverBusinesses({ mode: "recent", limit: discoverQuery.parse(request.query).limit }));
  fastify.get("/popular", limited, async (request) => discoverBusinesses({ mode: "popular", limit: discoverQuery.parse(request.query).limit }));
  fastify.get("/verified", limited, async (request) => discoverBusinesses({ mode: "verified", limit: discoverQuery.parse(request.query).limit }));

  // --- Categories ---
  fastify.get("/categories", limited, async () => ({ categories: await listCategories(), trending: await trendingCategories() }));
  fastify.get("/categories/:slug", limited, async (request) => {
    const { slug } = z.object({ slug: z.string().trim().min(1).max(80) }).parse(request.params);
    const query = discoverQuery.parse(request.query);
    return discoverBusinesses({ mode: query.mode ?? "browse", categorySlug: slug, query: query.q, bookableOnly: query.bookableOnly, limit: query.limit, cursor: query.cursor });
  });

  // --- Search ---
  fastify.get("/search", limited, async (request) => {
    const query = discoverQuery.parse(request.query);
    const result = await discoverBusinesses({ mode: query.mode ?? "browse", query: query.q, categorySlug: query.category, city: query.city, verifiedOnly: query.verifiedOnly, bookableOnly: query.bookableOnly, limit: query.limit, cursor: query.cursor });
    if (viewer && query.q) await recordSearch(viewer.profileId(request), query.q, result.items.length).catch(() => undefined);
    return result;
  });
  fastify.get("/search/suggestions", limited, async (request) => {
    const { q } = z.object({ q: z.string().trim().max(120).default("") }).parse(request.query);
    return searchSuggestions(q);
  });

  // --- Business profile (records a view) ---
  fastify.get("/businesses/:slug", limited, async (request) => {
    const { slug } = slugParam.parse(request.params);
    if (!viewer) return getMarketplaceBusinessProfile(slug);
    await recordBusinessView(viewer.profileId(request), slug).catch(() => undefined);
    return getMarketplaceBusinessProfile(slug, { customerProfileId: viewer.profileId(request) });
  });
  fastify.get("/promotions", limited, async () => activePromotions());
}

// Guest browsing (Apple 5.1.1(v)): anyone can search and view businesses without
// an account. Every action that needs one (favourite, follow, report, book,
// message) stays on the signed-in routes below.
export async function publicMarketplaceRoutes(fastify: FastifyInstance) {
  registerDiscoveryReads(fastify, null);
}

export default async function marketplaceRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);
  registerDiscoveryReads(fastify, { profileId: (request) => request.customer!.profileId });
  fastify.get("/search/recent", async (request) => recentSearches(request.customer!.profileId));

  // --- Customer actions ---
  fastify.post("/businesses/:slug/favourite", async (request) => {
    const { slug } = slugParam.parse(request.params);
    const { favourite } = z.object({ favourite: z.boolean() }).parse(request.body);
    return toggleFavourite(request.customer!.profileId, slug, favourite);
  });

  fastify.post("/businesses/:slug/follow", async (request) => {
    const { slug } = slugParam.parse(request.params);
    const { follow } = z.object({ follow: z.boolean() }).parse(request.body);
    return toggleFollow(request.customer!.profileId, slug, follow);
  });

  fastify.post("/businesses/:slug/report", async (request, reply) => {
    const { slug } = slugParam.parse(request.params);
    const input = z.object({ reason: z.enum(["spam", "inappropriate", "closed", "wrong_info", "scam", "other"]), detail: z.string().trim().max(2000).optional() }).parse(request.body);
    reply.status(201).send(await reportBusiness({ customerProfileId: request.customer!.profileId, slug, ...input }));
  });

  fastify.get("/businesses/:slug/share", async (request) => {
    const { slug } = slugParam.parse(request.params);
    return shareBusiness(request.customer!.profileId, slug);
  });

  fastify.get("/recently-viewed", async (request) => recentlyViewed(request.customer!.profileId));
  fastify.get("/favourites", async (request) => listFavourites(request.customer!.profileId));
  fastify.get("/following", async (request) => listFollowing(request.customer!.profileId));
}
