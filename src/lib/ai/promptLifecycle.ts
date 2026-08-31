import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { promptChecksum } from "./promptRender.js";

const DRAFT = "DRAFT";
const PUBLISHED = "PUBLISHED";
const RETIRED = "RETIRED";
const APPROVED = "APPROVED";
const REJECTED = "REJECTED";
const PENDING = "PENDING";

/** Opens (or returns the existing open) approval request for a draft version. */
export async function requestPromptApproval(input: { versionId: string; requestedByUserId?: string | null }) {
  const version = await prisma.promptVersion.findUnique({ where: { id: input.versionId } });
  if (!version) throw ApiError.notFound("Prompt version not found");
  if (version.status !== DRAFT) throw ApiError.badRequest("Only a draft prompt version can be submitted for approval");
  const open = await prisma.promptApproval.findFirst({ where: { versionId: input.versionId, status: PENDING } });
  if (open) return open;
  return prisma.promptApproval.create({ data: { versionId: input.versionId, requestedByUserId: input.requestedByUserId ?? null } });
}

export async function decidePromptApproval(input: {
  approvalId: string;
  approve: boolean;
  reviewedByUserId?: string | null;
  reason?: string | null;
}) {
  const approval = await prisma.promptApproval.findUnique({ where: { id: input.approvalId } });
  if (!approval) throw ApiError.notFound("Prompt approval not found");
  if (approval.status !== PENDING) throw ApiError.conflict("This approval has already been decided");
  return prisma.promptApproval.update({
    where: { id: input.approvalId },
    data: {
      status: input.approve ? APPROVED : REJECTED,
      reviewedByUserId: input.reviewedByUserId ?? null,
      reason: input.reason ?? null,
      decidedAt: new Date(),
    },
  });
}

/**
 * Promotes an approved draft version to PUBLISHED: retires the template's
 * previous published version, repoints currentVersionId, and supersedes the
 * prior active deployment with a fresh one. Refuses without an APPROVED
 * review recorded for this exact version.
 */
export async function publishPromptVersion(input: {
  versionId: string;
  deployedByUserId?: string | null;
  environment?: string;
}) {
  const environment = input.environment ?? "production";
  const version = await prisma.promptVersion.findUnique({ where: { id: input.versionId }, include: { variables: true } });
  if (!version) throw ApiError.notFound("Prompt version not found");
  if (version.status === PUBLISHED) throw ApiError.conflict("Prompt version is already published");
  if (version.status === RETIRED) throw ApiError.badRequest("A retired prompt version cannot be published again");

  const approved = await prisma.promptApproval.findFirst({ where: { versionId: input.versionId, status: APPROVED } });
  if (!approved) throw ApiError.forbidden("Prompt version requires an approved review before publishing");

  return prisma.$transaction(async (tx) => {
    const template = await tx.promptTemplate.findUniqueOrThrow({ where: { id: version.templateId } });
    if (template.currentVersionId && template.currentVersionId !== version.id) {
      await tx.promptVersion.update({
        where: { id: template.currentVersionId },
        data: { status: RETIRED, retiredAt: new Date() },
      });
    }
    await tx.promptVersion.update({ where: { id: version.id }, data: { status: PUBLISHED, publishedAt: new Date() } });
    await tx.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: version.id, status: PUBLISHED } });
    await tx.promptDeployment.updateMany({
      where: { templateId: template.id, businessId: null, environment, active: true },
      data: { active: false, supersededAt: new Date() },
    });
    const deployment = await tx.promptDeployment.create({
      data: { templateId: template.id, versionId: version.id, environment, deployedByUserId: input.deployedByUserId ?? null },
    });
    return { version: await tx.promptVersion.findUniqueOrThrow({ where: { id: version.id } }), deployment };
  });
}

export async function retirePromptVersion(input: { versionId: string }) {
  const version = await prisma.promptVersion.findUnique({ where: { id: input.versionId } });
  if (!version) throw ApiError.notFound("Prompt version not found");
  if (version.status === RETIRED) return version;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.promptVersion.update({ where: { id: version.id }, data: { status: RETIRED, retiredAt: new Date() } });
    const template = await tx.promptTemplate.findUniqueOrThrow({ where: { id: version.templateId } });
    if (template.currentVersionId === version.id) {
      await tx.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: null, status: DRAFT } });
      await tx.promptDeployment.updateMany({
        where: { templateId: template.id, versionId: version.id, active: true },
        data: { active: false, supersededAt: new Date() },
      });
    }
    return updated;
  });
}

/**
 * Re-points a template's active deployment at an already-published version —
 * the rollback path. The version must belong to the template and be
 * PUBLISHED.
 */
export async function deployPromptVersion(input: {
  templateId: string;
  versionId: string;
  businessId?: string | null;
  environment?: string;
  deployedByUserId?: string | null;
}) {
  const environment = input.environment ?? "production";
  const version = await prisma.promptVersion.findFirst({ where: { id: input.versionId, templateId: input.templateId } });
  if (!version) throw ApiError.badRequest("versionId does not belong to this template");
  if (version.status !== PUBLISHED) throw ApiError.badRequest("Only a published version can be deployed");
  return prisma.$transaction(async (tx) => {
    await tx.promptDeployment.updateMany({
      where: { templateId: input.templateId, businessId: input.businessId ?? null, environment, active: true },
      data: { active: false, supersededAt: new Date() },
    });
    if (!input.businessId) {
      await tx.promptTemplate.update({ where: { id: input.templateId }, data: { currentVersionId: input.versionId } });
    }
    return tx.promptDeployment.create({
      data: {
        templateId: input.templateId,
        versionId: input.versionId,
        businessId: input.businessId ?? null,
        environment,
        deployedByUserId: input.deployedByUserId ?? null,
      },
    });
  });
}

/** Upserts a business's override of a platform template — inline body and/or a pinned version. */
export async function setPromptOverride(input: {
  businessId: string;
  templateId: string;
  body?: string | null;
  systemPrompt?: string | null;
  versionId?: string | null;
}) {
  const template = await prisma.promptTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw ApiError.notFound("Prompt template not found");
  if (!input.body && !input.versionId) throw ApiError.badRequest("An override needs an inline body or a pinned versionId");
  if (input.versionId) {
    const pinned = await prisma.promptVersion.findFirst({ where: { id: input.versionId, templateId: input.templateId, status: PUBLISHED } });
    if (!pinned) throw ApiError.badRequest("versionId must be a published version of this template");
  }
  const checksum = input.body ? promptChecksum(input.body, input.systemPrompt ?? null) : null;
  return prisma.promptOverride.upsert({
    where: { businessId_templateId: { businessId: input.businessId, templateId: input.templateId } },
    create: {
      businessId: input.businessId,
      templateId: input.templateId,
      body: input.body ?? null,
      systemPrompt: input.systemPrompt ?? null,
      versionId: input.versionId ?? null,
      checksum,
    },
    update: { body: input.body ?? null, systemPrompt: input.systemPrompt ?? null, versionId: input.versionId ?? null, checksum, status: "ACTIVE" },
  });
}

export async function removePromptOverride(input: { businessId: string; templateId: string }) {
  await prisma.promptOverride.deleteMany({ where: { businessId: input.businessId, templateId: input.templateId } });
}
