import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

/**
 * Business visibility: a business sees PLATFORM-scoped packages plus its own.
 * Business manageability: only its own (BUSINESS-scoped) packages — a
 * business customizes a platform template through a PromptOverride, never by
 * mutating the shared platform package (that path belongs to the admin
 * console in 3B-7).
 */
export async function assertPackageManageable(businessId: string, packageId: string) {
  const pkg = await prisma.promptPackage.findUnique({ where: { id: packageId } });
  if (!pkg) throw ApiError.notFound("Prompt package not found");
  if (pkg.scope === "PLATFORM" || pkg.businessId !== businessId) {
    throw ApiError.forbidden("Platform prompt packages are managed by Chakusa administration");
  }
  return pkg;
}

export async function assertTemplateVisible(businessId: string, templateId: string) {
  const template = await prisma.promptTemplate.findUnique({ where: { id: templateId }, include: { package: true } });
  if (!template) throw ApiError.notFound("Prompt template not found");
  if (template.package.scope !== "PLATFORM" && template.package.businessId !== businessId) {
    throw ApiError.notFound("Prompt template not found");
  }
  return template;
}

export async function assertTemplateManageable(businessId: string, templateId: string) {
  const template = await assertTemplateVisible(businessId, templateId);
  if (template.package.scope === "PLATFORM" || template.package.businessId !== businessId) {
    throw ApiError.forbidden("This prompt template is managed by Chakusa administration — create an override instead");
  }
  return template;
}

export async function resolveManageableVersion(businessId: string, versionId: string) {
  const version = await prisma.promptVersion.findUnique({ where: { id: versionId } });
  if (!version) throw ApiError.notFound("Prompt version not found");
  await assertTemplateManageable(businessId, version.templateId);
  return version;
}

export async function resolveManageableApproval(businessId: string, approvalId: string) {
  const approval = await prisma.promptApproval.findUnique({ where: { id: approvalId }, include: { version: true } });
  if (!approval) throw ApiError.notFound("Prompt approval not found");
  await assertTemplateManageable(businessId, approval.version.templateId);
  return approval;
}
