import { prisma } from "../../prisma.js";
import { mapIndustryToCategory } from "../../marketplace/categories.js";
import { customerBookingAIContext } from "../../booking/customerBooking.js";

// PROGRAM 2 LOOP 4: read-only context for the Customer AI Assistant. This is
// the customer-scoped analogue of aiGateway.ts's businessAIContext — it
// aggregates from the EXISTING Customer Platform / Marketplace / Booking /
// Review tables and derives nothing new into storage. It is passed as the
// `context` argument to routeAI(); it never talks to a model itself.

export interface CustomerAssistantSettings {
  personalizationEnabled: boolean;
  memoryEnabled: boolean;
  recommendationsEnabled: boolean;
  language: string;
  notifyOnReply: boolean;
  notifyRecommendations: boolean;
}

/** Reads the assistant knobs out of the existing profile JSON columns — no new table. */
export function readAssistantSettings(profile: {
  preferredLanguage: string;
  privacySettings: unknown;
  communicationPreferences: unknown;
  notificationPreferences: unknown;
}): CustomerAssistantSettings {
  const privacy = (profile.privacySettings ?? {}) as Record<string, unknown>;
  const comms = (profile.communicationPreferences ?? {}) as Record<string, unknown>;
  const notif = (profile.notificationPreferences ?? {}) as Record<string, { push?: boolean; email?: boolean }>;
  const assistant = (comms.assistant ?? {}) as Record<string, unknown>;
  return {
    personalizationEnabled: privacy.allowAIPersonalisation !== false,
    memoryEnabled: assistant.memoryEnabled !== false,
    recommendationsEnabled: assistant.recommendationsEnabled !== false,
    language: (assistant.language as string) ?? profile.preferredLanguage ?? "en",
    notifyOnReply: notif.ai_reply?.push !== false,
    notifyRecommendations: notif.recommendation?.push === true || notif.promotion?.push === true,
  };
}

/** Writes the assistant knobs back into the existing profile JSON columns — no new table. */
export async function updateAssistantSettings(
  customerProfileId: string,
  patch: Partial<{ personalizationEnabled: boolean; memoryEnabled: boolean; recommendationsEnabled: boolean; language: string; notifyOnReply: boolean; notifyRecommendations: boolean }>,
): Promise<CustomerAssistantSettings> {
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { id: customerProfileId },
    select: { preferredLanguage: true, privacySettings: true, communicationPreferences: true, notificationPreferences: true },
  });
  const privacy = { ...((profile.privacySettings ?? {}) as Record<string, unknown>) };
  const comms = { ...((profile.communicationPreferences ?? {}) as Record<string, unknown>) };
  const assistant = { ...((comms.assistant ?? {}) as Record<string, unknown>) };
  const notif = JSON.parse(JSON.stringify(profile.notificationPreferences ?? {})) as Record<string, { push?: boolean; email?: boolean }>;

  if (patch.personalizationEnabled !== undefined) privacy.allowAIPersonalisation = patch.personalizationEnabled;
  if (patch.memoryEnabled !== undefined) assistant.memoryEnabled = patch.memoryEnabled;
  if (patch.recommendationsEnabled !== undefined) assistant.recommendationsEnabled = patch.recommendationsEnabled;
  if (patch.language !== undefined) assistant.language = patch.language;
  if (patch.notifyOnReply !== undefined) notif.ai_reply = { ...(notif.ai_reply ?? {}), push: patch.notifyOnReply };
  if (patch.notifyRecommendations !== undefined) notif.recommendation = { ...(notif.recommendation ?? {}), push: patch.notifyRecommendations };
  comms.assistant = assistant;

  const updated = await prisma.customerProfile.update({
    where: { id: customerProfileId },
    data: {
      privacySettings: privacy as never,
      communicationPreferences: comms as never,
      notificationPreferences: notif as never,
    },
    select: { preferredLanguage: true, privacySettings: true, communicationPreferences: true, notificationPreferences: true },
  });
  return readAssistantSettings(updated);
}

export interface PersonalizationProfile {
  preferredBusinesses: Array<{ slug: string | null; name: string; visits: number }>;
  preferredServices: Array<{ name: string; count: number }>;
  preferredStaff: Array<{ name: string; count: number }>;
  preferredTimeOfDay: "morning" | "afternoon" | "evening" | null;
  preferredWeekday: string | null;
  language: string;
  communicationStyle: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Derives learned preferences purely from the customer's own booking + favourite history. */
export async function buildPersonalizationProfile(customerProfileId: string): Promise<PersonalizationProfile> {
  const [profile, links, appts] = await Promise.all([
    prisma.customerProfile.findUniqueOrThrow({ where: { id: customerProfileId }, select: { preferredLanguage: true, communicationPreferences: true } }),
    prisma.customerBusinessLink.findMany({ where: { customerProfileId, businessCustomerId: { not: null } }, select: { businessId: true, businessCustomerId: true, favourite: true } }),
    prisma.appointment.findMany({
      where: { OR: [{ bookedByCustomerProfileId: customerProfileId }] },
      orderBy: { startsAt: "desc" },
      take: 60,
      select: { serviceName: true, startsAt: true, businessId: true, status: true, assignedMember: { select: { user: { select: { fullName: true } } } } },
    }),
  ]);

  const businessIds = [...new Set([...links.map((l) => l.businessId), ...appts.map((a) => a.businessId)])];
  const businesses = businessIds.length
    ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } })
    : [];
  const bizById = new Map(businesses.map((b) => [b.id, b]));

  const bizVisits = new Map<string, number>();
  const serviceCount = new Map<string, number>();
  const staffCount = new Map<string, number>();
  const hourBuckets = { morning: 0, afternoon: 0, evening: 0 };
  const weekdayCount = new Array(7).fill(0);
  for (const appt of appts) {
    bizVisits.set(appt.businessId, (bizVisits.get(appt.businessId) ?? 0) + 1);
    serviceCount.set(appt.serviceName, (serviceCount.get(appt.serviceName) ?? 0) + 1);
    const staff = appt.assignedMember?.user.fullName;
    if (staff) staffCount.set(staff, (staffCount.get(staff) ?? 0) + 1);
    const hour = appt.startsAt.getUTCHours();
    if (hour < 12) hourBuckets.morning += 1;
    else if (hour < 17) hourBuckets.afternoon += 1;
    else hourBuckets.evening += 1;
    weekdayCount[appt.startsAt.getUTCDay()] += 1;
  }
  // favourites count as a soft visit signal
  for (const link of links) if (link.favourite) bizVisits.set(link.businessId, (bizVisits.get(link.businessId) ?? 0) + 1);

  const rankedTime = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0];
  const topTime = rankedTime && rankedTime[1] > 0 ? (rankedTime[0] as "morning" | "afternoon" | "evening") : null;
  const topWeekdayIdx = weekdayCount.some((n) => n > 0) ? weekdayCount.indexOf(Math.max(...weekdayCount)) : -1;
  const comms = (profile.communicationPreferences ?? {}) as Record<string, unknown>;

  return {
    preferredBusinesses: [...bizVisits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, visits]) => ({ slug: bizById.get(id)?.publicSlug ?? null, name: bizById.get(id)?.name ?? "Unknown", visits })),
    preferredServices: [...serviceCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    preferredStaff: [...staffCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
    preferredTimeOfDay: topTime,
    preferredWeekday: topWeekdayIdx >= 0 ? WEEKDAYS[topWeekdayIdx] ?? null : null,
    language: (comms.assistant as Record<string, unknown> | undefined)?.language as string ?? profile.preferredLanguage ?? "en",
    communicationStyle: (comms.preferredChannel as string) ?? "push",
  };
}

export interface AssistantAchievement {
  code: string;
  label: string;
}

/** Derived milestones — computed, never stored. No rewards, points or redemption. */
function deriveAchievements(input: { completedBookings: number; reviews: number; favourites: number; memberSince: Date }): AssistantAchievement[] {
  const out: AssistantAchievement[] = [];
  if (input.completedBookings >= 1) out.push({ code: "first_booking", label: "First appointment completed" });
  if (input.completedBookings >= 5) out.push({ code: "regular", label: "5 appointments completed" });
  if (input.completedBookings >= 15) out.push({ code: "loyal", label: "15 appointments completed" });
  if (input.reviews >= 1) out.push({ code: "first_review", label: "First review left" });
  if (input.reviews >= 5) out.push({ code: "reviewer", label: "5 reviews left" });
  if (input.favourites >= 3) out.push({ code: "curator", label: "3 favourite businesses saved" });
  const months = Math.floor((Date.now() - input.memberSince.getTime()) / (30 * 86_400_000));
  if (months >= 6) out.push({ code: "six_months", label: "Member for 6 months" });
  if (months >= 12) out.push({ code: "one_year", label: "Member for a year" });
  return out;
}

export interface CustomerAssistantContext {
  profile: { name: string; language: string; timezone: string };
  settings: CustomerAssistantSettings;
  personalization: PersonalizationProfile | null;
  bookings: Awaited<ReturnType<typeof customerBookingAIContext>>;
  favouriteBusinesses: Array<{ slug: string | null; name: string; category: string }>;
  favouriteServices: Array<{ name: string; count: number }>;
  recentlyViewed: Array<{ slug: string | null; name: string }>;
  recentSearches: string[];
  reviews: Array<{ businessName: string; rating: number; comment: string | null; createdAt: Date }>;
  reviewedBusinessIds: string[];
  loyalty: {
    tier: "new" | "returning" | "loyal" | "vip";
    engagementTier: "new" | "returning" | "loyal" | "vip";
    completedBookings: number;
    totalPoints: number;
    lifetimePoints: number;
    accounts: unknown[];
    activeMemberships: number;
    memberships: unknown[];
    rewards: { issued: number; redeemed: number; list: unknown[] };
    referrals: { total: number; joined: number; completed: number };
  };
  achievements: AssistantAchievement[];
  conversationSummaries: string[];
}

/** The full customer-scoped context object handed to routeAI(). */
export async function buildCustomerAssistantContext(customerProfileId: string): Promise<CustomerAssistantContext> {
  const profile = await prisma.customerProfile.findUniqueOrThrow({
    where: { id: customerProfileId },
    select: {
      displayName: true, preferredLanguage: true, preferredTimezone: true, createdAt: true,
      privacySettings: true, communicationPreferences: true, notificationPreferences: true,
      user: { select: { fullName: true } },
    },
  });
  const settings = readAssistantSettings(profile);

  const links = await prisma.customerBusinessLink.findMany({
    where: { customerProfileId },
    select: { businessId: true, businessCustomerId: true, favourite: true },
  });
  const favBusinessIds = links.filter((l) => l.favourite).map((l) => l.businessId);
  const customerRowIds = links.map((l) => l.businessCustomerId).filter((v): v is string => Boolean(v));

  const [bookings, favBusinesses, recentViews, recentSearchRows, feedbackRows, personalization] = await Promise.all([
    customerBookingAIContext(customerProfileId),
    favBusinessIds.length
      ? prisma.business.findMany({ where: { id: { in: favBusinessIds } }, select: { id: true, name: true, publicSlug: true, industry: true, marketplaceListing: { select: { categorySlug: true } } } })
      : [],
    prisma.customerBusinessView.findMany({ where: { customerProfileId }, orderBy: { viewedAt: "desc" }, take: 10, select: { businessId: true } }),
    prisma.customerRecentSearch.findMany({ where: { customerProfileId }, orderBy: { createdAt: "desc" }, take: 10, select: { query: true } }),
    customerRowIds.length
      ? prisma.feedback.findMany({ where: { customerId: { in: customerRowIds } }, orderBy: { createdAt: "desc" }, take: 20, select: { businessId: true, rating: true, comment: true, createdAt: true } })
      : [],
    settings.personalizationEnabled ? buildPersonalizationProfile(customerProfileId) : Promise.resolve(null),
  ]);

  const viewBusinessIds = [...new Set(recentViews.map((v) => v.businessId))];
  const reviewBusinessIds = [...new Set(feedbackRows.map((f) => f.businessId))];
  const extraBusinesses = [...viewBusinessIds, ...reviewBusinessIds].filter((id) => !favBusinesses.some((b) => b.id === id));
  const otherBusinesses = extraBusinesses.length
    ? await prisma.business.findMany({ where: { id: { in: extraBusinesses } }, select: { id: true, name: true, publicSlug: true } })
    : [];
  const nameById = new Map([...favBusinesses, ...otherBusinesses].map((b) => [b.id, b]));

  const completedBookings = bookings.historyCount;
  const heuristicTier = completedBookings >= 15 ? "vip" : completedBookings >= 5 ? "loyal" : completedBookings >= 1 ? "returning" : "new";

  // PROGRAM 2 LOOP 5: real loyalty standing from the stored ledger.
  const { getWallet } = await import("../../loyalty/wallet.js");
  const wallet = await getWallet(customerProfileId).catch(() => null);

  const summaries = await prisma.aIMemoryRecord.findMany({
    where: { businessId: { in: [...new Set(links.map((l) => l.businessId))].length ? [...new Set(links.map((l) => l.businessId))] : ["__none__"] }, scope: "CONVERSATION", kind: "summary", customerId: { in: customerRowIds.length ? customerRowIds : ["__none__"] }, supersededById: null },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { content: true },
  });

  return {
    profile: { name: profile.displayName ?? profile.user.fullName, language: settings.language, timezone: profile.preferredTimezone },
    settings,
    personalization,
    bookings,
    favouriteBusinesses: favBusinesses.map((b) => ({ slug: b.publicSlug, name: b.name, category: b.marketplaceListing?.categorySlug ?? mapIndustryToCategory(b.industry) })),
    favouriteServices: personalization?.preferredServices ?? [],
    recentlyViewed: viewBusinessIds.map((id) => ({ slug: nameById.get(id)?.publicSlug ?? null, name: nameById.get(id)?.name ?? "Unknown" })),
    recentSearches: recentSearchRows.map((r) => r.query),
    reviews: feedbackRows.map((f) => ({ businessName: nameById.get(f.businessId)?.name ?? "Unknown", rating: f.rating, comment: f.comment, createdAt: f.createdAt })),
    reviewedBusinessIds: reviewBusinessIds,
    loyalty: {
      tier: heuristicTier,
      engagementTier: heuristicTier,
      completedBookings,
      totalPoints: wallet?.totalPoints ?? 0,
      lifetimePoints: wallet?.lifetimePoints ?? 0,
      accounts: wallet?.accounts ?? [],
      activeMemberships: wallet?.activeMemberships ?? 0,
      memberships: wallet?.memberships ?? [],
      rewards: wallet?.rewards ?? { issued: 0, redeemed: 0, list: [] },
      referrals: wallet?.referrals ?? { total: 0, joined: 0, completed: 0 },
    },
    achievements: deriveAchievements({ completedBookings, reviews: feedbackRows.length, favourites: favBusinessIds.length, memberSince: profile.createdAt }),
    conversationSummaries: summaries.map((s) => s.content),
  };
}
