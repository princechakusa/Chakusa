import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { assertUnderLimit, getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import type { CreateTemplateInput, UpdateTemplateInput } from "./templates.schemas.js";
import type { Plan } from "@prisma/client";

export async function listTemplates(businessId: string) {
  return prisma.messageTemplate.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
}

/**
 * The Free cap only applies to non-default templates — a business's
 * `isDefault` row per templateType is treated as replacing the built-in
 * system default (see src/lib/defaultTemplates.ts, which never creates a
 * row at all) rather than as an extra custom template, so setting/changing
 * a default is never blocked by this limit.
 */
export async function createTemplate(businessId: string, input: CreateTemplateInput, plan: Plan) {
  const limit = getPlanLimits(plan).customTemplatesPerType;

  return withLimitCheck(async (tx) => {
    if (!input.isDefault && limit !== null) {
      const current = await tx.messageTemplate.count({
        where: { businessId, templateType: input.templateType, isDefault: false },
      });
      assertUnderLimit({ plan, resource: "templates", limit, current });
    }

    if (input.isDefault) {
      await tx.messageTemplate.updateMany({
        where: { businessId, templateType: input.templateType },
        data: { isDefault: false },
      });
    }

    return tx.messageTemplate.create({ data: { businessId, ...input } });
  });
}

export async function updateTemplate(
  businessId: string,
  templateId: string,
  input: UpdateTemplateInput,
) {
  const existing = await prisma.messageTemplate.findFirst({
    where: { id: templateId, businessId },
  });
  if (!existing) {
    throw ApiError.notFound("Template not found");
  }

  if (input.isDefault) {
    await prisma.messageTemplate.updateMany({
      where: { businessId, templateType: input.templateType ?? existing.templateType },
      data: { isDefault: false },
    });
  }

  return prisma.messageTemplate.update({ where: { id: templateId }, data: input });
}
