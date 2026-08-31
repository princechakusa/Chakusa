import { prisma } from "../../lib/prisma.js";
import { unreadNotificationCount } from "../../lib/customer/customerNotifications.js";
import { mapIndustryToCategory } from "../../lib/marketplace/categories.js";
import { customerBookingAIContext } from "../../lib/booking/customerBooking.js";

// PROGRAM 2 LOOP 1: read-only aggregation for the customer dashboard. It
// reuses the Business, Appointment, Conversation, Feedback and
// AIConversationRun models — nothing is duplicated. Visual refinement is a
// later loop; this returns the foundational shape.

/** The business-scoped Customer contact rows this profile is linked to, by business. */
async function linkedBusinessCustomerIds(customerProfileId: string) {
  const links = await prisma.customerBusinessLink.findMany({
    where: { customerProfileId, businessCustomerId: { not: null } },
    select: { businessId: true, businessCustomerId: true },
  });
  return links.map((link) => ({ businessId: link.businessId, businessCustomerId: link.businessCustomerId! }));
}

export async function getCustomerDashboard(customerProfileId: string) {
  const links = await prisma.customerBusinessLink.findMany({
    where: { customerProfileId },
    orderBy: [{ favourite: "desc" }, { lastInteractionAt: "desc" }],
    take: 50,
  });
  const businessIds = [...new Set(links.map((link) => link.businessId))];
  const customerRowIds = links.map((link) => link.businessCustomerId).filter((value): value is string => Boolean(value));

  const [businesses, upcomingAppointments, recentConversations, recentReviews, aiRuns, unread, activity] = await Promise.all([
    businessIds.length
      ? prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, industry: true, publicSlug: true, timezone: true } })
      : [],
    customerRowIds.length
      ? prisma.appointment.findMany({
          where: { customerId: { in: customerRowIds }, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gte: new Date() } },
          orderBy: { startsAt: "asc" },
          take: 10,
          select: { id: true, businessId: true, serviceName: true, startsAt: true, endsAt: true, status: true },
        })
      : [],
    customerRowIds.length
      ? prisma.conversation.findMany({
          where: { customerId: { in: customerRowIds }, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true, businessId: true, status: true, subject: true, lastInboundAt: true, lastOutboundAt: true, updatedAt: true },
        })
      : [],
    customerRowIds.length
      ? prisma.feedback.findMany({
          where: { customerId: { in: customerRowIds } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, businessId: true, rating: true, comment: true, createdAt: true },
        })
      : [],
    customerRowIds.length
      ? prisma.aIConversationRun.findMany({
          where: { customerId: { in: customerRowIds } },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { id: true, businessId: true, conversationId: true, status: true, updatedAt: true },
        })
      : [],
    unreadNotificationCount(customerProfileId),
    prisma.customerActivityEvent.findMany({ where: { customerProfileId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const byId = new Map(businesses.map((business) => [business.id, business]));
  const withBusiness = <T extends { businessId: string }>(row: T) => ({ ...row, business: byId.get(row.businessId) ?? null });

  return {
    savedBusinesses: links.filter((link) => link.favourite).map((link) => ({ ...link, business: byId.get(link.businessId) ?? null })),
    businesses: links.map((link) => ({ ...link, business: byId.get(link.businessId) ?? null })),
    upcomingAppointments: upcomingAppointments.map(withBusiness),
    recentConversations: recentConversations.map(withBusiness),
    recentReviews: recentReviews.map(withBusiness),
    aiAssistant: { recentRuns: aiRuns.map(withBusiness), entryEnabled: aiRuns.length > 0 || links.length > 0 },
    unreadNotifications: unread,
    activityHistory: activity,
    generatedAt: new Date().toISOString(),
  };
}

export async function getCustomerAIConversations(customerProfileId: string) {
  const linked = await linkedBusinessCustomerIds(customerProfileId);
  if (!linked.length) return { conversations: [] };
  const runs = await prisma.aIConversationRun.findMany({
    where: { customerId: { in: linked.map((entry) => entry.businessCustomerId) } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, businessId: true, conversationId: true, status: true, mode: true, createdAt: true, updatedAt: true },
  });
  return { conversations: runs };
}

export async function getCustomerAIContext(customerProfileId: string) {
  const profile = await prisma.customerProfile.findUnique({
    where: { id: customerProfileId },
    include: { user: { select: { fullName: true } }, businessLinks: { select: { businessId: true, businessCustomerId: true, favourite: true } } },
  });
  if (!profile) return null;

  // PROGRAM 2 LOOP 2: expose marketplace discovery signals so the Customer AI
  // understands which businesses this customer favourites, follows and has
  // recently viewed. Reads only — the LOOP 3 AI Platform is unchanged.
  const [favourites, follows, recentViews] = await Promise.all([
    prisma.customerBusinessLink.findMany({
      where: { customerProfileId, favourite: true },
      orderBy: { lastInteractionAt: "desc" },
      take: 50,
      select: { businessId: true },
    }),
    prisma.businessFollow.findMany({
      where: { customerProfileId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { businessId: true },
    }),
    prisma.customerBusinessView.findMany({
      where: { customerProfileId },
      orderBy: { viewedAt: "desc" },
      take: 20,
      select: { businessId: true, viewedAt: true },
    }),
  ]);
  const discoveryBusinessIds = [...new Set([...favourites, ...follows, ...recentViews].map((row) => row.businessId))];
  const discoveryBusinesses = discoveryBusinessIds.length
    ? await prisma.business.findMany({
        where: { id: { in: discoveryBusinessIds } },
        select: { id: true, name: true, publicSlug: true, industry: true, marketplaceListing: { select: { categorySlug: true } } },
      })
    : [];
  const discoveryById = new Map(discoveryBusinesses.map((business) => [business.id, business]));

  // PROGRAM 2 LOOP 3: booking history + rebooking recommendations so the
  // Customer AI can explain/recommend services and suggest future visits.
  const bookings = await customerBookingAIContext(customerProfileId);

  return {
    name: profile.displayName ?? profile.user.fullName,
    preferredLanguage: profile.preferredLanguage,
    preferredTimezone: profile.preferredTimezone,
    communicationPreferences: profile.communicationPreferences,
    privacySettings: profile.privacySettings,
    allowAIPersonalisation: (profile.privacySettings as { allowAIPersonalisation?: boolean })?.allowAIPersonalisation !== false,
    linkedBusinesses: profile.businessLinks,
    favouriteBusinesses: favourites.map((link) => {
      const business = discoveryById.get(link.businessId);
      return {
        businessId: link.businessId,
        name: business?.name ?? null,
        slug: business?.publicSlug ?? null,
        category: business?.marketplaceListing?.categorySlug ?? (business ? mapIndustryToCategory(business.industry) : null),
      };
    }),
    followedBusinesses: follows.map((follow) => ({ businessId: follow.businessId, name: discoveryById.get(follow.businessId)?.name ?? null, slug: discoveryById.get(follow.businessId)?.publicSlug ?? null })),
    recentlyViewedBusinesses: recentViews.map((view) => ({ businessId: view.businessId, name: discoveryById.get(view.businessId)?.name ?? null, slug: discoveryById.get(view.businessId)?.publicSlug ?? null, viewedAt: view.viewedAt })),
    bookings,
  };
}
