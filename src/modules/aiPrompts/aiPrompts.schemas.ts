import { z } from "zod";

const key = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/, "key may only contain letters, numbers, dot, dash, underscore");
const name = z.string().trim().min(1).max(160);

export const createPackageSchema = z.object({
  key,
  name,
  description: z.string().trim().max(2000).nullish(),
});

export const createCategorySchema = z.object({ key, name, description: z.string().trim().max(2000).nullish() });

export const createTemplateSchema = z.object({
  key,
  name,
  description: z.string().trim().max(2000).nullish(),
  task: z.enum(["classification", "conversation", "scheduling", "extraction"]),
  categoryId: z.string().uuid().nullish(),
});

export const variableSchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_.]+$/),
  description: z.string().trim().max(500).nullish(),
  type: z.enum(["string", "number", "boolean", "json"]).default("string"),
  required: z.boolean().default(true),
  defaultValue: z.string().max(4000).nullish(),
});

export const createVersionSchema = z.object({
  body: z.string().min(1).max(20000),
  systemPrompt: z.string().max(20000).nullish(),
  model: z.string().trim().max(120).nullish(),
  requiredCapability: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  variables: z.array(variableSchema).max(60).default([]),
});

export const localizationSchema = z.object({
  locale: z.string().trim().min(2).max(20),
  body: z.string().min(1).max(20000),
  systemPrompt: z.string().max(20000).nullish(),
});

export const overrideSchema = z
  .object({
    body: z.string().min(1).max(20000).nullish(),
    systemPrompt: z.string().max(20000).nullish(),
    versionId: z.string().uuid().nullish(),
  })
  .refine((value) => Boolean(value.body) || Boolean(value.versionId), { message: "Provide an inline body or a pinned versionId" });

export const approvalDecisionSchema = z.object({ approve: z.boolean(), reason: z.string().trim().max(2000).nullish() });

export const assertionSchema = z.object({
  type: z.enum(["contains", "notContains", "equals", "matches", "minConfidence"]),
  value: z.union([z.string(), z.number()]),
});

export const testCaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  variables: z.record(z.string(), z.unknown()).default({}),
  context: z.record(z.string(), z.unknown()).nullish(),
  assertions: z.array(assertionSchema).min(1).max(50),
});

export const publishSchema = z.object({ environment: z.string().trim().max(40).optional() });

export const resolveSchema = z.object({
  templateKey: z.string().trim().min(1).max(120),
  packageKey: z.string().trim().min(1).max(120).optional(),
  locale: z.string().trim().min(2).max(20).nullish(),
  values: z.record(z.string(), z.unknown()).default({}),
});
