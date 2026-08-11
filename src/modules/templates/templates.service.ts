import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { CreateTemplateInput, UpdateTemplateInput } from "./templates.schemas.js";

export async function listTemplates(businessId: string) {
  return prisma.messageTemplate.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
}

export async function createTemplate(businessId: string, input: CreateTemplateInput) {
  if (input.isDefault) {
    await prisma.messageTemplate.updateMany({
      where: { businessId, templateType: input.templateType },
      data: { isDefault: false },
    });
  }

  return prisma.messageTemplate.create({ data: { businessId, ...input } });
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
