import type { Prisma, PromptVersion } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { assertSafeAIInput, type AITask } from "./aiGateway.js";
import { promptChecksum, PROMPT_VARIABLE_TYPES, renderPrompt, type DeclaredVariable, type RenderResult } from "./promptRender.js";

export const PLATFORM_PACKAGE_KEY = "platform";
export const PROMPT_TASKS: AITask[] = ["classification", "conversation", "scheduling", "extraction"];
const PUBLISHED = "PUBLISHED";
const DRAFT = "DRAFT";
const RETIRED = "RETIRED";

export interface VariableInput {
  name: string;
  description?: string | null;
  type?: string;
  required?: boolean;
  defaultValue?: string | null;
}

function assertVariableInputs(variables: VariableInput[]): void {
  const seen = new Set<string>();
  for (const variable of variables) {
    if (!/^[a-zA-Z0-9_.]+$/.test(variable.name)) throw ApiError.badRequest(`Invalid prompt variable name: ${variable.name}`);
    if (seen.has(variable.name)) throw ApiError.badRequest(`Duplicate prompt variable: ${variable.name}`);
    seen.add(variable.name);
    if (variable.type && !PROMPT_VARIABLE_TYPES.includes(variable.type as never)) {
      throw ApiError.badRequest(`Invalid prompt variable type: ${variable.type}`);
    }
  }
}

export async function createPromptPackage(input: {
  businessId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  scope?: "PLATFORM" | "BUSINESS";
}) {
  const scope = input.scope ?? (input.businessId ? "BUSINESS" : "PLATFORM");
  if (scope === "BUSINESS" && !input.businessId) throw ApiError.badRequest("A business-scoped prompt package requires a businessId");
  if (scope === "PLATFORM" && input.businessId) throw ApiError.badRequest("A platform prompt package cannot be bound to a business");
  return prisma.promptPackage.create({
    data: { businessId: input.businessId ?? null, key: input.key, name: input.name, description: input.description ?? null, scope },
  });
}

export async function createPromptCategory(input: { packageId: string; key: string; name: string; description?: string | null }) {
  await getPackageOrThrow(input.packageId);
  return prisma.promptCategory.create({
    data: { packageId: input.packageId, key: input.key, name: input.name, description: input.description ?? null },
  });
}

export async function createPromptTemplate(input: {
  packageId: string;
  categoryId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  task: string;
}) {
  if (!PROMPT_TASKS.includes(input.task as never)) throw ApiError.badRequest(`Unsupported prompt task: ${input.task}`);
  await getPackageOrThrow(input.packageId);
  if (input.categoryId) {
    const category = await prisma.promptCategory.findFirst({ where: { id: input.categoryId, packageId: input.packageId } });
    if (!category) throw ApiError.badRequest("categoryId does not belong to this package");
  }
  return prisma.promptTemplate.create({
    data: {
      packageId: input.packageId,
      categoryId: input.categoryId ?? null,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      task: input.task,
    },
  });
}

/**
 * Creates the next immutable draft version of a template. Body, system
 * prompt, model and declared variables are frozen at creation — a change is
 * always a new version, never an in-place edit. The stored checksum pins the
 * exact text this version will ever render from.
 */
export async function createPromptVersion(input: {
  templateId: string;
  body: string;
  systemPrompt?: string | null;
  model?: string | null;
  requiredCapability?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  variables?: VariableInput[];
}) {
  const template = await prisma.promptTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw ApiError.notFound("Prompt template not found");
  if (!input.body.trim()) throw ApiError.badRequest("Prompt version body cannot be empty");
  assertSafeAIInput(input.body);
  if (input.systemPrompt) assertSafeAIInput(input.systemPrompt);
  const variables = input.variables ?? [];
  assertVariableInputs(variables);

  const last = await prisma.promptVersion.findFirst({
    where: { templateId: input.templateId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;
  const checksum = promptChecksum(input.body, input.systemPrompt ?? null);

  return prisma.$transaction(async (tx) => {
    const created = await tx.promptVersion.create({
      data: {
        templateId: input.templateId,
        version,
        status: DRAFT,
        body: input.body,
        systemPrompt: input.systemPrompt ?? null,
        model: input.model ?? null,
        requiredCapability: input.requiredCapability ?? null,
        notes: input.notes ?? null,
        checksum,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    if (variables.length) {
      await tx.promptVariable.createMany({
        data: variables.map((variable) => ({
          versionId: created.id,
          name: variable.name,
          description: variable.description ?? null,
          type: variable.type ?? "string",
          required: variable.required ?? true,
          defaultValue: variable.defaultValue ?? null,
        })),
      });
    }
    return tx.promptVersion.findUniqueOrThrow({ where: { id: created.id }, include: { variables: true } });
  });
}

export async function addPromptLocalization(input: {
  versionId: string;
  locale: string;
  body: string;
  systemPrompt?: string | null;
}) {
  const version = await prisma.promptVersion.findUnique({ where: { id: input.versionId } });
  if (!version) throw ApiError.notFound("Prompt version not found");
  if (version.status === RETIRED) throw ApiError.badRequest("Cannot localize a retired prompt version");
  assertSafeAIInput(input.body);
  return prisma.promptLocalization.upsert({
    where: { versionId_locale: { versionId: input.versionId, locale: input.locale } },
    create: {
      versionId: input.versionId,
      locale: input.locale,
      body: input.body,
      systemPrompt: input.systemPrompt ?? null,
      checksum: promptChecksum(input.body, input.systemPrompt ?? null),
    },
    update: { body: input.body, systemPrompt: input.systemPrompt ?? null, checksum: promptChecksum(input.body, input.systemPrompt ?? null) },
  });
}

export async function listPromptPackages(businessId?: string | null) {
  return prisma.promptPackage.findMany({
    where: { OR: [{ scope: "PLATFORM" }, ...(businessId ? [{ businessId }] : [])] },
    include: { categories: true, templates: { select: { id: true, key: true, name: true, task: true, status: true, currentVersionId: true } } },
    orderBy: [{ scope: "asc" }, { key: "asc" }],
  });
}

export async function getPromptTemplate(templateId: string) {
  const template = await prisma.promptTemplate.findUnique({
    where: { id: templateId },
    include: {
      package: true,
      category: true,
      versions: { orderBy: { version: "desc" }, include: { variables: true, approvals: { orderBy: { createdAt: "desc" } }, localizations: true } },
      deployments: { where: { active: true } },
    },
  });
  if (!template) throw ApiError.notFound("Prompt template not found");
  return template;
}

export interface ResolvedPrompt {
  templateId: string;
  templateKey: string;
  task: string;
  versionId: string;
  version: number;
  body: string;
  systemPrompt: string | null;
  model: string | null;
  requiredCapability: string | null;
  checksum: string;
  locale: string | null;
  variables: DeclaredVariable[];
  source: "platform" | "override" | "localization";
}

/**
 * Resolves the prompt a business should run for a logical template key:
 * the template's currently published version, with a business PromptOverride
 * (pinned version or inline body) and a locale-specific PromptLocalization
 * layered on when present. Throws if nothing is published.
 */
export async function resolvePublishedPrompt(input: {
  templateKey: string;
  businessId?: string | null;
  packageKey?: string;
  locale?: string | null;
}): Promise<ResolvedPrompt> {
  const visibleScopes = [{ scope: "PLATFORM" as const }, ...(input.businessId ? [{ businessId: input.businessId }] : [])];
  const candidates = await prisma.promptTemplate.findMany({
    where: {
      key: input.templateKey,
      package: input.packageKey ? { key: input.packageKey, OR: visibleScopes } : { OR: visibleScopes },
    },
    include: { package: { select: { scope: true, businessId: true } } },
  });
  // A business's own template wins over the shared platform one of the same key.
  const template =
    candidates.find((row) => input.businessId && row.package.businessId === input.businessId) ??
    candidates.find((row) => row.package.scope === "PLATFORM");
  if (!template) throw ApiError.notFound(`No prompt template published for "${input.templateKey}"`);

  const override = input.businessId
    ? await prisma.promptOverride.findUnique({ where: { businessId_templateId: { businessId: input.businessId, templateId: template.id } } })
    : null;
  const activeOverride = override && override.status === "ACTIVE" ? override : null;

  let version: (PromptVersion & { variables: DeclaredVariable[] }) | null = null;
  let source: ResolvedPrompt["source"] = "platform";

  if (activeOverride?.versionId) {
    version = await loadVersionWithVariables(activeOverride.versionId);
    source = "override";
  } else if (!template.currentVersionId) {
    throw ApiError.notFound(`Prompt template "${input.templateKey}" has no published version`);
  } else {
    version = await loadVersionWithVariables(template.currentVersionId);
  }

  if (!version || version.status !== PUBLISHED) {
    throw ApiError.notFound(`Prompt template "${input.templateKey}" has no published version`);
  }

  let body = version.body;
  let systemPrompt = version.systemPrompt;
  let checksum = version.checksum;
  let locale: string | null = null;

  if (activeOverride?.body) {
    body = activeOverride.body;
    systemPrompt = activeOverride.systemPrompt ?? null;
    checksum = activeOverride.checksum ?? promptChecksum(body, systemPrompt);
    source = "override";
  }

  if (input.locale) {
    const localization = await prisma.promptLocalization.findUnique({
      where: { versionId_locale: { versionId: version.id, locale: input.locale } },
    });
    if (localization) {
      body = localization.body;
      systemPrompt = localization.systemPrompt ?? null;
      checksum = localization.checksum;
      locale = localization.locale;
      source = "localization";
    }
  }

  return {
    templateId: template.id,
    templateKey: template.key,
    task: template.task,
    versionId: version.id,
    version: version.version,
    body,
    systemPrompt,
    model: version.model,
    requiredCapability: version.requiredCapability,
    checksum,
    locale,
    variables: version.variables,
    source,
  };
}

/** Loads a version by id and asserts it is PUBLISHED — the gate routeAI() uses. */
export async function getPublishedVersionOrThrow(versionId: string) {
  const version = await loadVersionWithVariables(versionId);
  if (!version) throw ApiError.notFound("Prompt version not found");
  if (version.status !== PUBLISHED) throw ApiError.badRequest("Prompt version is not published");
  return version;
}

/** Convenience: resolve + render in one call, returning the rendered text plus its version id. */
export async function renderPublishedPrompt(input: {
  templateKey: string;
  businessId?: string | null;
  packageKey?: string;
  locale?: string | null;
  values: Record<string, unknown>;
}): Promise<ResolvedPrompt & { rendered: RenderResult }> {
  const resolved = await resolvePublishedPrompt(input);
  const rendered = renderPrompt({
    body: resolved.body,
    systemPrompt: resolved.systemPrompt,
    variables: resolved.variables,
    values: input.values,
  });
  return { ...resolved, rendered };
}

async function loadVersionWithVariables(versionId: string) {
  return prisma.promptVersion.findUnique({ where: { id: versionId }, include: { variables: true } });
}

async function getPackageOrThrow(packageId: string) {
  const pkg = await prisma.promptPackage.findUnique({ where: { id: packageId } });
  if (!pkg) throw ApiError.notFound("Prompt package not found");
  return pkg;
}

export type PromptTransactionClient = Prisma.TransactionClient;
