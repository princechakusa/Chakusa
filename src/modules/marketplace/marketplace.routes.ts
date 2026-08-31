import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DISCOVERY_MODES, discoverBusinesses, getMarketplaceBusinessProfile, searchSuggestions } from "../../lib/marketplace/discovery.js";
import { listCategories, trendingCategories } from "../../lib/marketplace/categories.js";
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
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().uuid().optional(),
});

export default async function marketplaceRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  // --- Discovery ---
  fastify.get("/", async (request) => {
    const query = discoverQuery.parse(request.query);
    return discoverBusinesses({ mode: query.mode ?? "browse", categorySlug: query.category, query: query.q, city: query.city, verifiedOnly: query.verifiedOnly, limit: query.limit, cursor: query.cursor });
  });

  fastify.get("/nearby", async (request) => {
    const query = discoverQuery.parse(request.query);
    return discoverBusinesses({ mode: "nearby", lat: query.lat, lng: query.lng, radiusKm: query.radiusKm, categorySlug: query.category, query: query.q, limit: query.limit, cursor: query.cursor });
  });

  fastify.get("/featured", async (request) => discoverBusinesses({ mode: "featured", limit: discoverQuery.parse(request.query).limit }));
  fastify.get("/recent", async (request) => discoverBusinesses({ mode: "recent", limit: discoverQuery.parse(request.query).limit }));
  fastify.get("/popular", async (request) => discoverBusinesses({ mode: "popular", limit: discoverQuery.parse(request.query).limit }));
  fastify.get("/verified", async (request) => discoverBusinesses({ mode: "verified", limit: discoverQuery.parse(request.query).limit }));

  // --- Categories ---
  fastify.get("/categories", async () => ({ categories: await listCategories(), trending: await trendingCategories() }));
  fastify.get("/categories/:slug", async (request) => {
    const { slug } = z.object({ slug: z.string().trim().min(1).max(80) }).parse(request.params);
    const query = discoverQuery.parse(request.query);
    return discoverBusinesses({ mode: query.mode ?? "browse", categorySlug: slug, query: query.q, limit: query.limit, cursor: query.cursor });
  });

  // --- Search ---
  fastify.get("/search", async (request) => {
    const query = discoverQuery.parse(request.query);
    const result = await discoverBusinesses({ mode: query.mode ?? "browse", query: query.q, categorySlug: query.category, city: query.city, verifiedOnly: query.verifiedOnly, limit: query.limit, cursor: query.cursor });
    if (query.q) await recordSearch(request.customer!.profileId, query.q, result.items.length).catch(() => undefined);
    return result;
  });
  fastify.get("/search/suggestions", async (request) => {
    const { q } = z.object({ q: z.string().trim().max(120).default("") }).parse(request.query);
    return searchSuggestions(q);
  });
  fastify.get("/search/recent", async (request) => recentSearches(request.customer!.profileId));

  // --- Business profile (records a view) ---
  fastify.get("/businesses/:slug", async (request) => {
    const { slug } = slugParam.parse(request.params);
    await recordBusinessView(request.customer!.profileId, slug).catch(() => undefined);
    return getMarketplaceBusinessProfile(slug, { customerProfileId: request.customer!.profileId });
  });

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
  fastify.get("/promotions", async () => activePromotions());
}
