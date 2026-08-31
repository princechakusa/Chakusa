import { z } from "zod";
import { prisma } from "../../prisma.js";
import { discoverBusinesses, searchSuggestions, getMarketplaceBusinessProfile } from "../../marketplace/discovery.js";
import { listCategories, trendingCategories } from "../../marketplace/categories.js";
import { activePromotions, listFavourites, recentlyViewed, recentSearches } from "../../marketplace/customerMarketplace.js";
import {
  listBookableServices,
  getBookingAvailability,
  createCustomerBooking,
  rescheduleCustomerBooking,
  cancelCustomerBooking,
  listCustomerBookings,
} from "../../booking/customerBooking.js";
import { recommendForCustomer } from "./recommendations.js";

// PROGRAM 2 LOOP 4 — Customer AI Assistant tools. These are the ONLY actions
// the assistant can take. Every one is a thin call into an already-approved
// service (Marketplace discovery, Booking Platform, Review system) and every
// execution goes through the existing Tool Broker (executeAITool) so the
// Policy Engine's TOOL_EXECUTION checkpoint, the idempotency guard and the
// invocation ledger all apply unchanged. No new search, availability,
// booking or review logic is introduced here. All reads/writes are scoped
// to ctx.customerProfileId — a customer can never reach another customer's
// data through a tool.

export interface CustomerAssistantToolContext {
  customerProfileId: string;
  businessId: string;
  runId: string;
  conversationId: string;
}

export interface CustomerAssistantTool {
  name: string;
  description: string;
  mutating: boolean;
  schema: z.ZodTypeAny;
  run(ctx: CustomerAssistantToolContext, args: unknown): Promise<{ output: unknown }>;
}

const isoDateTime = z.string().datetime({ offset: true });

const tools: Record<string, CustomerAssistantTool> = {
  search_businesses: {
    name: "search_businesses",
    description: "Search the marketplace for businesses by keyword, category, city or discovery mode.",
    mutating: false,
    schema: z.object({
      q: z.string().trim().max(200).optional(),
      category: z.string().trim().max(80).optional(),
      city: z.string().trim().max(120).optional(),
      mode: z.enum(["browse", "featured", "recent", "popular", "verified", "nearby"]).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      verifiedOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async run(_ctx, args) {
      const input = this.schema.parse(args) as Record<string, unknown>;
      const page = await discoverBusinesses({
        mode: (input.mode as "browse") ?? "browse",
        query: input.q as string | undefined,
        categorySlug: input.category as string | undefined,
        city: input.city as string | undefined,
        verifiedOnly: input.verifiedOnly as boolean | undefined,
        lat: input.lat as number | undefined,
        lng: input.lng as number | undefined,
        limit: (input.limit as number) ?? 8,
      });
      return { output: { businesses: page.items, nextCursor: page.nextCursor } };
    },
  },

  search_services: {
    name: "search_services",
    description: "Find businesses that offer a named service.",
    mutating: false,
    schema: z.object({ q: z.string().trim().min(2).max(120), limit: z.number().int().min(1).max(20).optional() }),
    async run(_ctx, args) {
      const input = this.schema.parse(args) as { q: string; limit?: number };
      const page = await discoverBusinesses({ mode: "browse", query: input.q, limit: input.limit ?? 8 });
      return { output: { matches: page.items } };
    },
  },

  find_business: {
    name: "find_business",
    description: "Resolve a business by name to its marketplace slug.",
    mutating: false,
    schema: z.object({ name: z.string().trim().min(2).max(160) }),
    async run(_ctx, args) {
      const input = this.schema.parse(args) as { name: string };
      const suggestions = await searchSuggestions(input.name, 5);
      return { output: suggestions };
    },
  },

  view_business_profile: {
    name: "view_business_profile",
    description: "Return a business's public profile: about, services, opening hours, contact, address, team, promotions and review summary.",
    mutating: false,
    schema: z.object({ slug: z.string().trim().min(1).max(200) }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { slug: string };
      const profile = await getMarketplaceBusinessProfile(input.slug, { customerProfileId: ctx.customerProfileId });
      return { output: profile };
    },
  },

  search_categories: {
    name: "search_categories",
    description: "List marketplace industry categories and the trending ones.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run() {
      const [categories, trending] = await Promise.all([listCategories(), trendingCategories()]);
      return { output: { categories, trending } };
    },
  },

  check_availability: {
    name: "check_availability",
    description: "List open appointment slots for a service at a business between two timestamps.",
    mutating: false,
    schema: z.object({ slug: z.string().trim().min(1).max(200), serviceOfferingId: z.string().uuid(), from: isoDateTime, to: isoDateTime, memberId: z.string().uuid().optional() }),
    async run(_ctx, args) {
      const input = this.schema.parse(args) as { slug: string; serviceOfferingId: string; from: string; to: string; memberId?: string };
      const result = await getBookingAvailability(input.slug, { serviceOfferingId: input.serviceOfferingId, from: input.from, to: input.to, memberId: input.memberId });
      return { output: { timezone: result.timezone, slots: result.slots.slice(0, 12) } };
    },
  },

  list_services: {
    name: "list_services",
    description: "List the bookable services at a business.",
    mutating: false,
    schema: z.object({ slug: z.string().trim().min(1).max(200) }),
    async run(_ctx, args) {
      const input = this.schema.parse(args) as { slug: string };
      return { output: await listBookableServices(input.slug) };
    },
  },

  create_booking: {
    name: "create_booking",
    description: "Book an appointment for the customer. Requires an explicit service and start time the customer has confirmed.",
    mutating: true,
    schema: z.object({
      slug: z.string().trim().min(1).max(200),
      serviceOfferingId: z.string().uuid(),
      assignedMemberId: z.string().uuid().optional(),
      startsAt: isoDateTime,
      notes: z.string().trim().max(1000).optional(),
    }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { slug: string; serviceOfferingId: string; assignedMemberId?: string; startsAt: string; notes?: string };
      const result = await createCustomerBooking(ctx.customerProfileId, input);
      return { output: { appointmentId: result.appointment.id, status: result.appointment.status, startsAt: result.appointment.startsAt, receipt: result.receipt } };
    },
  },

  reschedule_booking: {
    name: "reschedule_booking",
    description: "Move one of the customer's own bookings to a new time.",
    mutating: true,
    schema: z.object({ bookingId: z.string().uuid(), startsAt: isoDateTime, assignedMemberId: z.string().uuid().optional() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { bookingId: string; startsAt: string; assignedMemberId?: string };
      const result = await rescheduleCustomerBooking(ctx.customerProfileId, input.bookingId, { startsAt: input.startsAt, assignedMemberId: input.assignedMemberId });
      return { output: result };
    },
  },

  cancel_booking: {
    name: "cancel_booking",
    description: "Cancel one of the customer's own bookings.",
    mutating: true,
    schema: z.object({ bookingId: z.string().uuid() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { bookingId: string };
      const result = await cancelCustomerBooking(ctx.customerProfileId, input.bookingId);
      return { output: result };
    },
  },

  booking_history: {
    name: "booking_history",
    description: "List the customer's past or upcoming bookings.",
    mutating: false,
    schema: z.object({ scope: z.enum(["upcoming", "past", "all"]).optional() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { scope?: "upcoming" | "past" | "all" };
      const rows = await listCustomerBookings(ctx.customerProfileId, input.scope ?? "all");
      return { output: { bookings: rows.slice(0, 20) } };
    },
  },

  next_booking: {
    name: "next_booking",
    description: "Return the customer's next upcoming booking, if any.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run(ctx) {
      const rows = await listCustomerBookings(ctx.customerProfileId, "upcoming");
      return { output: { next: rows[0] ?? null } };
    },
  },

  favourite_businesses: {
    name: "favourite_businesses",
    description: "List the businesses the customer has favourited.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run(ctx) {
      return { output: { favourites: await listFavourites(ctx.customerProfileId) } };
    },
  },

  recently_viewed: {
    name: "recently_viewed",
    description: "List businesses the customer recently viewed and their recent searches.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run(ctx) {
      const [viewed, searches] = await Promise.all([recentlyViewed(ctx.customerProfileId, 10), recentSearches(ctx.customerProfileId, 10)]);
      return { output: { recentlyViewed: viewed, recentSearches: searches.map((s) => s.query) } };
    },
  },

  promotions: {
    name: "promotions",
    description: "List active marketplace promotions.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run() {
      return { output: { promotions: await activePromotions(20) } };
    },
  },

  reviews: {
    name: "reviews",
    description: "List the customer's own reviews, and which favourite businesses they have not reviewed yet.",
    mutating: false,
    schema: z.object({}).passthrough(),
    async run(ctx) {
      const links = await prisma.customerBusinessLink.findMany({
        where: { customerProfileId: ctx.customerProfileId },
        select: { businessId: true, businessCustomerId: true, favourite: true },
      });
      const customerRowIds = links.map((l) => l.businessCustomerId).filter((v): v is string => Boolean(v));
      const feedback = customerRowIds.length
        ? await prisma.feedback.findMany({ where: { customerId: { in: customerRowIds } }, orderBy: { createdAt: "desc" }, take: 30, select: { businessId: true, rating: true, comment: true, createdAt: true } })
        : [];
      const businessIds = [...new Set([...links.map((l) => l.businessId), ...feedback.map((f) => f.businessId)])];
      const businesses = businessIds.length
        ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } })
        : [];
      const byId = new Map(businesses.map((b) => [b.id, b]));
      const reviewedIds = new Set(feedback.map((f) => f.businessId));
      return {
        output: {
          myReviews: feedback.map((f) => ({ businessName: byId.get(f.businessId)?.name ?? "Unknown", slug: byId.get(f.businessId)?.publicSlug ?? null, rating: f.rating, comment: f.comment, createdAt: f.createdAt })),
          reviewedBusinesses: [...reviewedIds].map((id) => byId.get(id)?.name ?? "Unknown"),
          favouritesNotReviewed: links
            .filter((l) => l.favourite && !reviewedIds.has(l.businessId))
            .map((l) => ({ name: byId.get(l.businessId)?.name ?? "Unknown", slug: byId.get(l.businessId)?.publicSlug ?? null })),
        },
      };
    },
  },

  recommendations: {
    name: "recommendations",
    description: "Explainable recommendations: repeat bookings due, businesses similar to favourites, nearby, highly rated, and active promotions.",
    mutating: false,
    schema: z.object({ lat: z.number().optional(), lng: z.number().optional(), limit: z.number().int().min(1).max(15).optional() }),
    async run(ctx, args) {
      const input = this.schema.parse(args) as { lat?: number; lng?: number; limit?: number };
      return { output: { recommendations: await recommendForCustomer(ctx.customerProfileId, input) } };
    },
  },
};

export const CUSTOMER_ASSISTANT_TOOL_NAMES = Object.keys(tools);
export function getCustomerAssistantTool(name: string): CustomerAssistantTool | undefined {
  return tools[name];
}
export function isCustomerAssistantTool(name: string): boolean {
  return name in tools;
}

/** Tool schemas exposed to the model (name + JSON-ish description only). */
export function customerAssistantToolManifest() {
  return Object.values(tools).map((tool) => ({ name: tool.name, description: tool.description, mutating: tool.mutating }));
}
