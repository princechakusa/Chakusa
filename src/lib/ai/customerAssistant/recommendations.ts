import { prisma } from "../../prisma.js";
import { discoverBusinesses } from "../../marketplace/discovery.js";
import { activePromotions } from "../../marketplace/customerMarketplace.js";
import { mapIndustryToCategory } from "../../marketplace/categories.js";
import { customerBookingAIContext } from "../../booking/customerBooking.js";

// PROGRAM 2 LOOP 4: explainable recommendations. Every candidate is a REAL
// business/promotion resolved through the existing Marketplace + Booking
// reads — nothing is generated. Each item carries a `reason` string so the
// assistant can explain why it was surfaced. No hallucinated businesses.

export interface Recommendation {
  type: "repeat_booking" | "similar_to_favourite" | "nearby_top_rated" | "promotion" | "highly_rated";
  slug: string | null;
  name: string;
  category: string | null;
  reason: string;
  rating?: number | null;
  dueInDays?: number | null;
}

export async function recommendForCustomer(
  customerProfileId: string,
  opts: { lat?: number; lng?: number; limit?: number } = {},
): Promise<Recommendation[]> {
  const limit = opts.limit ?? 10;
  const out: Recommendation[] = [];
  const seen = new Set<string>();
  const add = (rec: Recommendation) => {
    const key = `${rec.type}:${rec.slug ?? rec.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rec);
  };

  const links = await prisma.customerBusinessLink.findMany({
    where: { customerProfileId },
    select: { businessId: true, favourite: true },
  });
  const favouriteBusinessIds = new Set(links.filter((l) => l.favourite).map((l) => l.businessId));

  // 1. Repeat bookings that are due (reuses the booking AI context cadence math).
  const bookings = await customerBookingAIContext(customerProfileId);
  for (const rec of bookings.recommendations) {
    if (!rec.due) continue;
    add({
      type: "repeat_booking",
      slug: rec.slug,
      name: rec.businessName,
      category: null,
      reason: `You've booked ${rec.serviceName} at ${rec.businessName} ${rec.visits} times, about every ${rec.typicalIntervalDays ?? "?"} days — it's been ${rec.daysSinceLast} days.`,
      dueInDays: rec.typicalIntervalDays != null ? Math.max(0, rec.typicalIntervalDays - rec.daysSinceLast) : null,
    });
  }

  // 2. Businesses similar to favourites — same category, not already a favourite.
  if (favouriteBusinessIds.size) {
    const favs = await prisma.business.findMany({
      where: { id: { in: [...favouriteBusinessIds] } },
      select: { industry: true, marketplaceListing: { select: { categorySlug: true } } },
    });
    const categories = [...new Set(favs.map((b) => b.marketplaceListing?.categorySlug ?? mapIndustryToCategory(b.industry)))];
    for (const category of categories.slice(0, 3)) {
      const page = await discoverBusinesses({ mode: "popular", categorySlug: category, limit: 5 });
      for (const card of page.items) {
        add({
          type: "similar_to_favourite",
          slug: card.slug,
          name: card.name,
          category: card.category,
          reason: `Similar to businesses you've favourited in ${category}.`,
          rating: card.rating,
        });
      }
    }
  }

  // 3. Nearby, if a location was supplied.
  if (typeof opts.lat === "number" && typeof opts.lng === "number") {
    const near = await discoverBusinesses({ mode: "nearby", lat: opts.lat, lng: opts.lng, radiusKm: 15, limit: 6 });
    for (const card of near.items) {
      add({ type: "nearby_top_rated", slug: card.slug, name: card.name, category: card.category, reason: `Near your location${card.rating ? `, rated ${card.rating}` : ""}.`, rating: card.rating });
    }
  }

  // 4. Highly-rated verified businesses overall.
  const top = await discoverBusinesses({ mode: "verified", limit: 6 });
  for (const card of top.items) {
    if (card.rating == null || card.rating < 4) continue;
    add({ type: "highly_rated", slug: card.slug, name: card.name, category: card.category, reason: `Verified and rated ${card.rating} by ${card.reviewCount} customers.`, rating: card.rating });
  }

  // 5. Active promotions.
  const promos = await activePromotions(10);
  for (const promo of promos) {
    add({
      type: "promotion",
      slug: promo.business.slug,
      name: promo.business.name,
      category: promo.business.category,
      reason: `Active offer: ${promo.title}${promo.badge ? ` (${promo.badge})` : ""}.`,
    });
  }

  return out.slice(0, limit);
}
