import { Prisma, type LegalDocumentType, type LegalAcceptanceScope } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";

// PROGRAM 2 LOOP 4: core legal-document + acceptance domain logic, shared
// by the public document-fetch route, the customer/business acceptance
// routes, and the admin management routes. Framework-agnostic on purpose,
// no Fastify types in this file, so it can be called from any of them.

export const LEGAL_DOCUMENT_TYPES = ["PRIVACY_POLICY", "TERMS_OF_SERVICE", "COOKIE_POLICY", "AI_DISCLOSURE"] as const satisfies readonly LegalDocumentType[];

export interface CreateLegalDraftInput {
  type: LegalDocumentType;
  title: string;
  content: string;
  summary?: string;
  effectiveAt?: Date | null;
  requiresReacceptance?: boolean;
  createdByAdminMembershipId: string;
}

/** Next version number for a type, 1 if none exist yet. Not exposed directly, only used by createDraftVersion. */
async function nextVersionNumber(type: LegalDocumentType, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<number> {
  const latest = await db.legalDocumentVersion.findFirst({ where: { type }, orderBy: { version: "desc" }, select: { version: true } });
  return (latest?.version ?? 0) + 1;
}

export async function createDraftVersion(input: CreateLegalDraftInput) {
  const version = await nextVersionNumber(input.type);
  return prisma.legalDocumentVersion.create({
    data: {
      type: input.type,
      version,
      status: "DRAFT",
      title: input.title,
      content: input.content,
      summary: input.summary,
      effectiveAt: input.effectiveAt ?? null,
      requiresReacceptance: input.requiresReacceptance ?? true,
      createdByAdminMembershipId: input.createdByAdminMembershipId,
    },
  });
}

export async function listVersions(type: LegalDocumentType) {
  return prisma.legalDocumentVersion.findMany({ where: { type }, orderBy: { version: "desc" } });
}

export async function getVersionOrThrow(versionId: string) {
  const version = await prisma.legalDocumentVersion.findUnique({ where: { id: versionId } });
  if (!version) throw ApiError.notFound("Legal document version not found");
  return version;
}

export async function getCurrentPublishedVersion(type: LegalDocumentType) {
  return prisma.legalDocumentVersion.findFirst({ where: { type, status: "PUBLISHED" }, orderBy: { version: "desc" } });
}

/**
 * Publishing a version and rolling back to a previous one are the same
 * operation underneath: archive whatever is currently PUBLISHED for this
 * type (if anything), then mark the target PUBLISHED. Content is never
 * rewritten, only which existing row currently holds PUBLISHED status
 * changes, so history is never lost, per the brief's own "never overwrite
 * history" requirement.
 */
async function setPublished(versionId: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.legalDocumentVersion.findUnique({ where: { id: versionId } });
    if (!target) throw ApiError.notFound("Legal document version not found");
    if (target.status === "PUBLISHED") throw ApiError.conflict("This version is already published");

    const currentlyPublished = await tx.legalDocumentVersion.findFirst({ where: { type: target.type, status: "PUBLISHED" } });
    if (currentlyPublished) {
      await tx.legalDocumentVersion.update({ where: { id: currentlyPublished.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    }
    const updated = await tx.legalDocumentVersion.update({ where: { id: target.id }, data: { status: "PUBLISHED", publishedAt: new Date(), archivedAt: null } });
    return { updated, previouslyPublished: currentlyPublished };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function publishVersion(versionId: string) {
  return setPublished(versionId);
}

/** Only meaningful on an ARCHIVED version, publishing an old one back. */
export async function rollbackToVersion(versionId: string) {
  const target = await getVersionOrThrow(versionId);
  if (target.status !== "ARCHIVED") throw ApiError.badRequest("Can only roll back to a version that is currently archived");
  return setPublished(versionId);
}

export async function archiveVersion(versionId: string) {
  const target = await getVersionOrThrow(versionId);
  if (target.status !== "PUBLISHED") throw ApiError.badRequest("Can only archive a version that is currently published");
  return prisma.legalDocumentVersion.update({ where: { id: versionId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
}

/** Admin override for the rare case a published version needs to force re-acceptance after the fact. */
export async function setRequiresReacceptance(versionId: string, requiresReacceptance: boolean) {
  await getVersionOrThrow(versionId);
  return prisma.legalDocumentVersion.update({ where: { id: versionId }, data: { requiresReacceptance } });
}

export interface RecordAcceptanceInput {
  userId: string;
  type: LegalDocumentType;
  scope: LegalAcceptanceScope;
  source: string;
  platform?: string;
  language?: string;
  country?: string;
  device?: string;
  ipAddress?: string;
  sessionId?: string;
  /** Cookie-category choices (analytics/functional/marketing booleans), only meaningful for type === "COOKIE_POLICY". */
  cookiePreferences?: { analytics: boolean; functional: boolean; marketing: boolean };
}

/** Insert-only. Never update an existing row, a re-acceptance is always a new row. */
export async function recordAcceptance(input: RecordAcceptanceInput) {
  const current = await getCurrentPublishedVersion(input.type);
  if (!current) throw ApiError.conflict(`No published ${input.type} exists to accept`);
  return prisma.legalAcceptanceEvent.create({
    data: {
      userId: input.userId,
      documentVersionId: current.id,
      scope: input.scope,
      source: input.source,
      platform: input.platform,
      language: input.language,
      country: input.country,
      device: input.device,
      ipAddress: input.ipAddress,
      sessionId: input.sessionId,
      metadata: input.cookiePreferences ? { cookiePreferences: input.cookiePreferences } : undefined,
    },
  });
}

export interface PendingAcceptance {
  type: LegalDocumentType;
  currentVersionId: string;
  currentVersion: number;
}

/**
 * Documents a given scope must have accepted the CURRENT published version
 * of, that they either haven't accepted at all or only accepted an older
 * version whose successor requires re-acceptance. Business accounts don't
 * need a Cookie Policy acceptance (that's a website/browser concern, not
 * an app-account concern) or a CUSTOMER-facing AI disclosure acceptance
 * distinct from the general Terms, hence the scope-based filter below
 * rather than checking all four types for everyone.
 */
// A business that turns on the AI customer agent is acting on AI's behalf
// toward its own customers, so AI_DISCLOSURE acceptance applies to
// business accounts too, not just customers using the in-app assistant.
// Subscription/billing terms are sections inside TERMS_OF_SERVICE (see the
// locked "4 documents, not 13" decision), not separate document types, so
// there's nothing additional to require for those here.
const TYPES_BY_SCOPE: Record<LegalAcceptanceScope, readonly LegalDocumentType[]> = {
  CUSTOMER: ["TERMS_OF_SERVICE", "PRIVACY_POLICY", "AI_DISCLOSURE"],
  BUSINESS: ["TERMS_OF_SERVICE", "PRIVACY_POLICY", "AI_DISCLOSURE"],
  ADMIN: [],
};

export async function getPendingAcceptances(userId: string, scope: LegalAcceptanceScope): Promise<PendingAcceptance[]> {
  const types = TYPES_BY_SCOPE[scope];
  const pending: PendingAcceptance[] = [];
  for (const type of types) {
    const current = await getCurrentPublishedVersion(type);
    if (!current) continue; // nothing published yet for this type, nothing to require
    if (!current.requiresReacceptance) continue;
    const accepted = await prisma.legalAcceptanceEvent.findFirst({ where: { userId, documentVersionId: current.id } });
    if (!accepted) pending.push({ type, currentVersionId: current.id, currentVersion: current.version });
  }
  return pending;
}

export async function acceptanceStatsForVersion(versionId: string) {
  const count = await prisma.legalAcceptanceEvent.count({ where: { documentVersionId: versionId } });
  return { versionId, acceptanceCount: count };
}

export async function searchAcceptanceEvents(filter: { userId?: string; documentVersionId?: string; type?: LegalDocumentType }, take = 100) {
  return prisma.legalAcceptanceEvent.findMany({
    where: {
      userId: filter.userId,
      documentVersionId: filter.documentVersionId,
      documentVersion: filter.type ? { type: filter.type } : undefined,
    },
    orderBy: { acceptedAt: "desc" },
    take: Math.min(take, 500),
    include: { documentVersion: { select: { type: true, version: true } } },
  });
}
