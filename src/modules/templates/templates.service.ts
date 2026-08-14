import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { assertUnderLimit, getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import type { CreateTemplateInput, UpdateTemplateInput } from "./templates.schemas.js";
import type { Plan } from "@prisma/client";

export async function listTemplates(businessId: string) {
  return prisma.messageTemplate.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
}

/**
 * The Free cap is "1 custom template per templateType" and applies to
 * EVERY row a business creates, regardless of its isDefault flag — the
 * system default (src/lib/defaultTemplates.ts's DEFAULT_TEMPLATE_BODIES)
 * never creates a database row at all, so any MessageTemplate row that
 * exists is, by definition, a custom template the business authored.
 * isDefault only controls which row wins at render time (see reviews/
 * reminders services' `orderBy: [{ isDefault: "desc" }, ...]`); it does
 * not make a row free to create.
 *
 * P0 fix: this previously counted only `isDefault: false` rows and skipped
 * the check entirely whenever the new row's `isDefault` was true — a Free
 * business could bypass the "1 per type" cap indefinitely by always
 * passing isDefault: true (which mobile's TemplatesScreen actually does on
 * every create). The count below now includes every row for that type
 * regardless of isDefault, so the limit can no longer be bypassed by the
 * flag.
 */
export async function createTemplate(businessId: string, input: CreateTemplateInput, plan: Plan) {
  const limit = getPlanLimits(plan).customTemplatesPerType;

  return withLimitCheck(async (tx) => {
    if (limit !== null) {
      const current = await tx.messageTemplate.count({
        where: { businessId, templateType: input.templateType },
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
