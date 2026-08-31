import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBusinessRole } from "../../lib/authorization.js";
import {
  addPromptLocalization,
  createPromptCategory,
  createPromptPackage,
  createPromptTemplate,
  createPromptVersion,
  getPromptTemplate,
  listPromptPackages,
  renderPublishedPrompt,
} from "../../lib/ai/promptRegistry.js";
import {
  decidePromptApproval,
  deployPromptVersion,
  publishPromptVersion,
  removePromptOverride,
  requestPromptApproval,
  retirePromptVersion,
  setPromptOverride,
} from "../../lib/ai/promptLifecycle.js";
import { createPromptTestCase, listPromptTestRuns, runPromptTests } from "../../lib/ai/promptTesting.js";
import {
  assertPackageManageable,
  assertTemplateManageable,
  assertTemplateVisible,
  resolveManageableApproval,
  resolveManageableVersion,
} from "./aiPrompts.service.js";
import {
  approvalDecisionSchema,
  createCategorySchema,
  createPackageSchema,
  createTemplateSchema,
  createVersionSchema,
  localizationSchema,
  overrideSchema,
  publishSchema,
  resolveSchema,
  testCaseSchema,
} from "./aiPrompts.schemas.js";

const idParams = z.object({ id: z.string().uuid() });
const MANAGE_ROLES = ["OWNER", "ADMIN"] as const;

export default async function aiPromptRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/packages", async (request) => listPromptPackages(request.businessId!));

  fastify.post("/packages", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const input = createPackageSchema.parse(request.body);
    reply.status(201).send(await createPromptPackage({ businessId: request.businessId!, scope: "BUSINESS", ...input }));
  });

  fastify.post("/packages/:id/categories", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await assertPackageManageable(request.businessId!, id);
    reply.status(201).send(await createPromptCategory({ packageId: id, ...createCategorySchema.parse(request.body) }));
  });

  fastify.post("/packages/:id/templates", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await assertPackageManageable(request.businessId!, id);
    reply.status(201).send(await createPromptTemplate({ packageId: id, ...createTemplateSchema.parse(request.body) }));
  });

  fastify.get("/templates/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    await assertTemplateVisible(request.businessId!, id);
    return getPromptTemplate(id);
  });

  fastify.post("/templates/:id/versions", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await assertTemplateManageable(request.businessId!, id);
    reply.status(201).send(
      await createPromptVersion({ templateId: id, createdByUserId: request.user!.userId, ...createVersionSchema.parse(request.body) }),
    );
  });

  fastify.post("/templates/:id/test-cases", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await assertTemplateManageable(request.businessId!, id);
    reply.status(201).send(await createPromptTestCase({ templateId: id, ...testCaseSchema.parse(request.body) }));
  });

  fastify.put("/templates/:id/override", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await assertTemplateVisible(request.businessId!, id);
    const input = overrideSchema.parse(request.body);
    return setPromptOverride({ businessId: request.businessId!, templateId: id, ...input });
  });

  fastify.delete("/templates/:id/override", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await assertTemplateVisible(request.businessId!, id);
    await removePromptOverride({ businessId: request.businessId!, templateId: id });
    reply.status(204).send();
  });

  fastify.post("/versions/:id/localizations", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    reply.status(201).send(await addPromptLocalization({ versionId: version.id, ...localizationSchema.parse(request.body) }));
  });

  fastify.post("/versions/:id/approval-request", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    reply.status(201).send(await requestPromptApproval({ versionId: version.id, requestedByUserId: request.user!.userId }));
  });

  fastify.post("/approvals/:id/decision", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const approval = await resolveManageableApproval(request.businessId!, idParams.parse(request.params).id);
    const input = approvalDecisionSchema.parse(request.body);
    return decidePromptApproval({ approvalId: approval.id, reviewedByUserId: request.user!.userId, ...input });
  });

  fastify.post("/versions/:id/publish", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    const input = publishSchema.parse(request.body ?? {});
    return publishPromptVersion({ versionId: version.id, deployedByUserId: request.user!.userId, environment: input.environment });
  });

  fastify.post("/versions/:id/retire", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    return retirePromptVersion({ versionId: version.id });
  });

  fastify.post("/versions/:id/deploy", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    return deployPromptVersion({ templateId: version.templateId, versionId: version.id, deployedByUserId: request.user!.userId });
  });

  fastify.post("/versions/:id/test-runs", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    reply.status(201).send(await runPromptTests({ versionId: version.id }));
  });

  fastify.get("/versions/:id/test-runs", async (request) => {
    const version = await resolveManageableVersion(request.businessId!, idParams.parse(request.params).id);
    return listPromptTestRuns(version.id);
  });

  fastify.post("/resolve", async (request) => {
    const input = resolveSchema.parse(request.body);
    const resolved = await renderPublishedPrompt({ businessId: request.businessId!, ...input });
    return {
      templateKey: resolved.templateKey,
      versionId: resolved.versionId,
      version: resolved.version,
      source: resolved.source,
      locale: resolved.locale,
      checksum: resolved.rendered.checksum,
      prompt: resolved.rendered.prompt,
      systemPrompt: resolved.rendered.systemPrompt,
      referencedVariables: resolved.rendered.referencedVariables,
    };
  });
}
