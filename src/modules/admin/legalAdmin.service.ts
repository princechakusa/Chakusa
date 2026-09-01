import type { LegalDocumentType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import {
  archiveVersion,
  createDraftVersion,
  getVersionOrThrow,
  listVersions,
  publishVersion,
  rollbackToVersion,
  searchAcceptanceEvents,
  setRequiresReacceptance,
  acceptanceStatsForVersion,
  type CreateLegalDraftInput,
} from "../../lib/legal/legalDocuments.service.js";
import { notifyCustomer } from "../../lib/customer/customerNotifications.js";
import { recordAdminAudit, type AdminAuditActor, type AdminAuditContext } from "./adminAudit.service.js";

const CUSTOMER_FACING_TYPES: readonly LegalDocumentType[] = ["PRIVACY_POLICY", "TERMS_OF_SERVICE", "AI_DISCLOSURE"];

const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentType, string> = {
  PRIVACY_POLICY: "Privacy Policy",
  TERMS_OF_SERVICE: "Terms of Service",
  COOKIE_POLICY: "Cookie Policy",
  AI_DISCLOSURE: "AI Disclosure",
};

/**
 * Best-effort fan-out to every active customer when a version that
 * requires re-acceptance publishes. Synchronous, in the admin request that
 * published the version, deliberately not moved to the worker queue yet:
 * fine at current customer volumes, but this is the first thing to move
 * to a background job (see src/worker.ts's existing pattern) once the
 * active customer count makes a synchronous loop too slow for one HTTP
 * request. Never fails the publish itself, each notification is
 * independently best-effort the same way notifyCustomer already is.
 */
async function notifyCustomersOfLegalUpdate(type: LegalDocumentType, versionId: string) {
  if (!CUSTOMER_FACING_TYPES.includes(type)) return;
  const label = LEGAL_DOCUMENT_LABELS[type];
  const profiles = await prisma.customerProfile.findMany({ where: { status: "ACTIVE" }, select: { id: true }, take: 5000 });
  for (const profile of profiles) {
    try {
      await notifyCustomer({
        customerProfileId: profile.id,
        category: "legal_update",
        title: `${label} updated`,
        body: `Our ${label} has changed. Please review and accept it to keep using Chakusa.`,
        data: { legalDocumentType: type, legalDocumentVersionId: versionId },
      });
    } catch {
      /* best-effort, one customer's failure never blocks the rest */
    }
  }
}

// PROGRAM 2 LOOP 4: thin admin wrapper around legalDocuments.service.ts,
// following the same actor + audit pattern as adminActions.service.ts.
// The transaction/immutability guarantees live in legalDocuments.service.ts
// itself (shared with the customer/business-facing routes), this file only
// adds the admin-specific concerns: audit logging and permission-gated
// entry points.

export async function createLegalDraft(actor: AdminAuditActor, input: Omit<CreateLegalDraftInput, "createdByAdminMembershipId">, context: AdminAuditContext) {
  const created = await createDraftVersion({ ...input, createdByAdminMembershipId: actor.membershipId });
  await recordAdminAudit({ actor, action: "LEGAL_DRAFT_CREATED", targetType: "legal_document_version", targetId: created.id, newValue: { type: created.type, version: created.version }, context });
  return created;
}

export async function publishLegalVersion(actor: AdminAuditActor, versionId: string, context: AdminAuditContext) {
  const before = await getVersionOrThrow(versionId);
  const { updated, previouslyPublished } = await publishVersion(versionId);
  await recordAdminAudit({
    actor,
    action: "LEGAL_VERSION_PUBLISHED",
    targetType: "legal_document_version",
    targetId: updated.id,
    oldValue: { status: before.status, previouslyPublishedVersionId: previouslyPublished?.id ?? null },
    newValue: { status: updated.status, publishedAt: updated.publishedAt },
    context,
  });
  if (updated.requiresReacceptance) {
    await notifyCustomersOfLegalUpdate(updated.type, updated.id);
  }
  return updated;
}

export async function archiveLegalVersion(actor: AdminAuditActor, versionId: string, context: AdminAuditContext) {
  const before = await getVersionOrThrow(versionId);
  const updated = await archiveVersion(versionId);
  await recordAdminAudit({ actor, action: "LEGAL_VERSION_ARCHIVED", targetType: "legal_document_version", targetId: updated.id, oldValue: { status: before.status }, newValue: { status: updated.status }, context });
  return updated;
}

export async function rollbackLegalVersion(actor: AdminAuditActor, versionId: string, context: AdminAuditContext) {
  const before = await getVersionOrThrow(versionId);
  const { updated, previouslyPublished } = await rollbackToVersion(versionId);
  await recordAdminAudit({
    actor,
    action: "LEGAL_VERSION_ROLLED_BACK",
    targetType: "legal_document_version",
    targetId: updated.id,
    oldValue: { status: before.status, previouslyPublishedVersionId: previouslyPublished?.id ?? null },
    newValue: { status: updated.status },
    context,
  });
  if (updated.requiresReacceptance) {
    await notifyCustomersOfLegalUpdate(updated.type, updated.id);
  }
  return updated;
}

export async function forceReacceptance(actor: AdminAuditActor, versionId: string, context: AdminAuditContext) {
  const before = await getVersionOrThrow(versionId);
  if (before.status !== "PUBLISHED") throw ApiError.badRequest("Can only force re-acceptance on a currently published version");
  const updated = await setRequiresReacceptance(versionId, true);
  await recordAdminAudit({ actor, action: "LEGAL_FORCE_REACCEPTANCE", targetType: "legal_document_version", targetId: updated.id, oldValue: { requiresReacceptance: before.requiresReacceptance }, newValue: { requiresReacceptance: true }, context });
  return updated;
}

export async function listLegalVersions(type: LegalDocumentType) {
  return listVersions(type);
}

export async function getLegalAcceptanceStats(versionId: string) {
  await getVersionOrThrow(versionId);
  return acceptanceStatsForVersion(versionId);
}

export async function searchLegalAcceptance(filter: { userId?: string; documentVersionId?: string; type?: LegalDocumentType }) {
  return searchAcceptanceEvents(filter);
}

/**
 * Breakdown of cookie-consent choices for the currently published Cookie
 * Policy version: how many chose Accept All / Reject Optional / Customize,
 * and how many enabled each optional category. A simple in-memory
 * aggregation over the acceptance rows, not a new analytics table, cookie
 * consent volume doesn't warrant one yet.
 */
export async function getCookieConsentAnalytics(versionId: string) {
  const version = await getVersionOrThrow(versionId);
  if (version.type !== "COOKIE_POLICY") throw new Error("Cookie consent analytics only apply to COOKIE_POLICY versions");
  const events = await searchAcceptanceEvents({ documentVersionId: versionId }, 5000);
  const bySource: Record<string, number> = {};
  const categoryCounts = { analytics: 0, functional: 0, marketing: 0 };
  let total = 0;
  for (const event of events) {
    total += 1;
    bySource[event.source] = (bySource[event.source] ?? 0) + 1;
    const prefs = (event.metadata as { cookiePreferences?: { analytics?: boolean; functional?: boolean; marketing?: boolean } } | null)?.cookiePreferences;
    if (prefs?.analytics) categoryCounts.analytics += 1;
    if (prefs?.functional) categoryCounts.functional += 1;
    if (prefs?.marketing) categoryCounts.marketing += 1;
  }
  return { versionId, total, bySource, categoryCounts };
}
