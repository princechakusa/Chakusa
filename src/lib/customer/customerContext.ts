import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";

// PROGRAM 2 LOOP 1: shared helpers for the Customer domain. A CustomerProfile
// is 1:1 with a User; its existence is what makes a User a customer.

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  booking_update: { push: true, email: true },
  message: { push: true, email: false },
  ai_reply: { push: true, email: false },
  promotion: { push: false, email: false },
  review_reminder: { push: true, email: false },
  appointment_reminder: { push: true, email: true },
  loyalty: { push: true, email: false },
} as const;

export const DEFAULT_PRIVACY_SETTINGS = {
  discoverableByPhone: true,
  shareBookingHistoryWithBusinesses: true,
  allowAIPersonalisation: true,
} as const;

export const DEFAULT_COMMUNICATION_PREFERENCES = {
  preferredChannel: "push",
  quietHours: null as null | { start: string; end: string },
} as const;

export async function ensureCustomerProfile(
  userId: string,
  seed: { displayName?: string | null; phone?: string | null; phoneE164?: string | null; preferredLanguage?: string; preferredTimezone?: string } = {},
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return db.customerProfile.upsert({
    where: { userId },
    create: {
      userId,
      displayName: seed.displayName ?? null,
      phone: seed.phone ?? null,
      phoneE164: seed.phoneE164 ?? null,
      preferredLanguage: seed.preferredLanguage ?? "en",
      preferredTimezone: seed.preferredTimezone ?? "UTC",
      notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES as unknown as Prisma.InputJsonValue,
      privacySettings: DEFAULT_PRIVACY_SETTINGS as unknown as Prisma.InputJsonValue,
      communicationPreferences: DEFAULT_COMMUNICATION_PREFERENCES as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export async function getCustomerProfileOrThrow(profileId: string) {
  const profile = await prisma.customerProfile.findUnique({ where: { id: profileId }, include: { user: { select: { id: true, email: true, fullName: true, emailVerifiedAt: true } } } });
  if (!profile) throw ApiError.notFound("Customer profile not found");
  return profile;
}

/**
 * Links a customer to a business. `businessCustomerId` ties the
 * authenticated customer to the business's existing contact row so
 * bookings, conversations and AI memory (all keyed on that row) attach.
 */
export async function linkCustomerToBusiness(input: {
  customerProfileId: string;
  businessId: string;
  businessCustomerId?: string | null;
  relationship?: string;
  favourite?: boolean;
}) {
  const now = new Date();
  return prisma.customerBusinessLink.upsert({
    where: { customerProfileId_businessId: { customerProfileId: input.customerProfileId, businessId: input.businessId } },
    create: {
      customerProfileId: input.customerProfileId,
      businessId: input.businessId,
      businessCustomerId: input.businessCustomerId ?? null,
      relationship: input.relationship ?? "CUSTOMER",
      favourite: input.favourite ?? false,
      firstInteractionAt: now,
      lastInteractionAt: now,
    },
    update: {
      lastInteractionAt: now,
      ...(input.businessCustomerId ? { businessCustomerId: input.businessCustomerId } : {}),
      ...(input.favourite !== undefined ? { favourite: input.favourite } : {}),
    },
  });
}

export async function recordCustomerActivity(input: {
  customerProfileId: string;
  businessId?: string | null;
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: unknown;
}) {
  return prisma.customerActivityEvent.create({
    data: {
      customerProfileId: input.customerProfileId,
      businessId: input.businessId ?? null,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Business-scoped customer contact rows that match this profile by phone/email — used to auto-link. */
export async function findMatchingBusinessCustomers(profileId: string) {
  const profile = await prisma.customerProfile.findUnique({
    where: { id: profileId },
    select: { phoneE164: true, user: { select: { email: true, normalizedEmail: true } } },
  });
  if (!profile) return [];
  return prisma.customer.findMany({
    where: {
      OR: [
        ...(profile.phoneE164 ? [{ phoneE164: profile.phoneE164 }] : []),
        ...(profile.user.email ? [{ email: profile.user.email }] : []),
      ],
    },
    select: { id: true, businessId: true },
    take: 50,
  });
}
