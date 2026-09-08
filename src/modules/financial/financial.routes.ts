import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { requireCapability } from "../../lib/authorization.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import {
  createExpenseReceiptDownload,
  deleteExpenseReceipt,
  downloadExpenseReceipt,
  expenseReceiptStorageHealth,
  listExpenseReceipts,
  uploadExpenseReceipt,
} from "../../lib/financial/expenseReceiptPlatform.js";
import {
  createExpenseCategorySchema,
  createExpenseSchema,
  createMileageTripSchema,
  financialSummaryQuerySchema,
  idParamSchema,
  listExpenseCategoriesQuerySchema,
  listExpensesQuerySchema,
  listMileageTripsQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
  updateMileageTripSchema,
} from "./financial.schemas.js";
import {
  archiveExpenseCategory,
  createExpense,
  createExpenseCategory,
  deleteExpense,
  getExpense,
  listExpenseCategories,
  listExpenses,
  updateExpense,
  updateExpenseCategory,
} from "./expenses.service.js";
import {
  createMileageTrip,
  deleteMileageTrip,
  getMileageTrip,
  listMileageTrips,
  updateMileageTrip,
} from "./mileage.service.js";
import { getFinancialSummary } from "./financialSummary.service.js";

// PROGRAM 3 / Financial Management. Route handlers do ONLY: auth
// (preHandler) -> role -> entitlement -> validation -> service ->
// response. All money, tenant scoping, mileage derivation and
// soft-delete rules live in the service layer.
//
// Authorization (Advanced Team #12 capability matrix, src/lib/capabilities.ts):
//   financial.operate        record/list spend (expenses, mileage, receipts) - OWNER/ADMIN/STAFF
//   financial.config.manage  category structure - OWNER/ADMIN (it reshapes every report)
//   financial.report.view    the money-in/out summary - OWNER/ADMIN only

async function resolveMemberId(businessId: string, userId: string): Promise<string> {
  const member = await prisma.businessMember.findFirst({ where: { businessId, userId }, select: { id: true } });
  if (!member) throw ApiError.forbidden("You do not have permission to perform this action");
  return member.id;
}

export default async function financialRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  // --- categories ---
  fastify.get("/categories", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const query = listExpenseCategoriesQuerySchema.parse(request.query);
    reply.send(await listExpenseCategories(request.businessId!, query));
  });

  fastify.post("/categories", async (request, reply) => {
    requireCapability(request, "financial.config.manage");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const input = createExpenseCategorySchema.parse(request.body);
    reply.status(201).send(await createExpenseCategory(request.businessId!, input));
  });

  fastify.patch<{ Params: { id: string } }>("/categories/:id", async (request, reply) => {
    requireCapability(request, "financial.config.manage");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    const input = updateExpenseCategorySchema.parse(request.body);
    reply.send(await updateExpenseCategory(request.businessId!, id, input));
  });

  fastify.delete<{ Params: { id: string } }>("/categories/:id", async (request, reply) => {
    requireCapability(request, "financial.config.manage");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    await archiveExpenseCategory(request.businessId!, id);
    reply.status(204).send();
  });

  // --- expenses ---
  fastify.get("/expenses", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const query = listExpensesQuerySchema.parse(request.query);
    reply.send(await listExpenses(request.businessId!, query));
  });

  fastify.post("/expenses", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const input = createExpenseSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(201).send(await createExpense(request.businessId!, memberId, input));
  });

  fastify.get<{ Params: { id: string } }>("/expenses/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    reply.send(await getExpense(request.businessId!, id));
  });

  fastify.patch<{ Params: { id: string } }>("/expenses/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    const input = updateExpenseSchema.parse(request.body);
    reply.send(await updateExpense(request.businessId!, id, input));
  });

  fastify.delete<{ Params: { id: string } }>("/expenses/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    await deleteExpense(request.businessId!, id);
    reply.status(204).send();
  });

  // --- mileage ---
  fastify.get("/mileage", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const query = listMileageTripsQuerySchema.parse(request.query);
    reply.send(await listMileageTrips(request.businessId!, query));
  });

  fastify.post("/mileage", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const input = createMileageTripSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(201).send(await createMileageTrip(request.businessId!, memberId, input));
  });

  fastify.get<{ Params: { id: string } }>("/mileage/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    reply.send(await getMileageTrip(request.businessId!, id));
  });

  fastify.patch<{ Params: { id: string } }>("/mileage/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    const input = updateMileageTripSchema.parse(request.body);
    reply.send(await updateMileageTrip(request.businessId!, id, input));
  });

  fastify.delete<{ Params: { id: string } }>("/mileage/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    await deleteMileageTrip(request.businessId!, id);
    reply.status(204).send();
  });

  // --- expense receipts (secure attachments) ---
  fastify.get<{ Params: { id: string } }>("/expenses/:id/receipts", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    reply.send(await listExpenseReceipts(request.businessId!, id));
  });

  fastify.post<{ Params: { id: string } }>(
    "/expenses/:id/receipts",
    { bodyLimit: 24 * 1024 * 1024 },
    async (request, reply) => {
      requireCapability(request, "financial.operate");
      assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
      const { id } = idParamSchema.parse(request.params);
      const input = z
        .object({
          fileName: z.string().trim().min(1).max(255),
          mimeType: z.string().trim().min(3).max(120),
          dataBase64: z.string().min(1).max(24 * 1024 * 1024),
        })
        .parse(request.body);
      reply.status(201).send(await uploadExpenseReceipt(request.businessId!, id, input));
    },
  );

  fastify.post<{ Params: { id: string } }>("/receipts/:id/download", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    reply.send(await createExpenseReceiptDownload(request.businessId!, id));
  });

  fastify.get<{ Params: { token: string } }>("/receipts/download/:token", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { token } = z.object({ token: z.string().min(20) }).parse(request.params);
    const result = await downloadExpenseReceipt(token);
    reply
      .header("content-type", result.receipt.detectedMime ?? result.receipt.declaredMime)
      .header(
        "content-disposition",
        `attachment; filename="${result.receipt.fileName.replace(/["\r\n]/g, "_")}"`,
      )
      .send(result.body);
  });

  fastify.delete<{ Params: { id: string } }>("/receipts/:id", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const { id } = idParamSchema.parse(request.params);
    await deleteExpenseReceipt(request.businessId!, id);
    reply.status(204).send();
  });

  fastify.get("/receipts/storage-status", async (request, reply) => {
    requireCapability(request, "financial.operate");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    reply.send(await expenseReceiptStorageHealth());
  });

  // --- money-in / money-out summary ---
  // A business-wide financial report: OWNER/ADMIN only (Advanced Team #12
  // matrix — STAFF may record spend but not see the rolled-up picture).
  fastify.get("/summary", async (request, reply) => {
    requireCapability(request, "financial.report.view");
    assertFeatureAvailable(request.plan!, "FINANCIAL_MANAGEMENT");
    const query = financialSummaryQuerySchema.parse(request.query);
    reply.send(await getFinancialSummary(request.businessId!, query));
  });
}
