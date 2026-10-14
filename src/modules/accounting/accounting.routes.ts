import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCapability } from "../../lib/authorization.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import {
  beginAccountingConnection,
  completeAccountingConnection,
  disconnectAccountingConnection,
  listAccountingConnections,
} from "./accountingConnections.service.js";
import { buildAccountingExportCsv, createAccountingExportToken, verifyAccountingExportToken } from "./accountingExport.service.js";

// PROGRAM 3 / Accounting Integrations A1. Connecting an external books
// system moves money data off-platform - "integrations.manage" capability
// (OWNER/ADMIN, Advanced Team #12 matrix), and gated on the
// ACCOUNTING_INTEGRATIONS entitlement. Handlers do only auth -> capability
// -> entitlement -> validation -> service.

const providerParamSchema = z.object({ provider: z.enum(["quickbooks", "xero"]) });
const authorizeBodySchema = z.object({ redirectUri: z.string().url() });
const callbackBodySchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096),
  redirectUri: z.string().url(),
});

const exportRangeSchema = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });

export default async function accountingRoutes(fastify: FastifyInstance) {
  // Accounting export download. Public on purpose: the browser that opens it
  // has no Bearer token. The short-lived HMAC link minted below is the only
  // authority, and it binds the business and the period.
  fastify.get<{ Querystring: { token?: string } }>("/export.csv", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1).max(2048) }).parse(request.query);
    const { businessId, from, to } = verifyAccountingExportToken(token);
    const csv = await buildAccountingExportCsv(businessId, from, to);
    const name = `chakusa-accounting-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("cache-control", "no-store")
      .send(csv);
  });

  fastify.register(async (authed) => {
    authed.addHook("preHandler", fastify.authenticate);
    authed.addHook("preHandler", fastify.requireBusiness);

    authed.post("/export-link", async (request, reply) => {
      requireCapability(request, "financial.report.view");
      assertFeatureAvailable(request.plan!, "ACCOUNTING_INTEGRATIONS");
      const { from, to } = exportRangeSchema.parse(request.body);
      const { token, expiresAt } = createAccountingExportToken(request.businessId!, new Date(from), new Date(to));
      reply.send({ path: `/accounting/export.csv?token=${encodeURIComponent(token)}`, expiresAt });
    });

    registerConnectionRoutes(authed);
  });
}

function registerConnectionRoutes(fastify: FastifyInstance) {

  fastify.get("/connections", async (request, reply) => {
    requireCapability(request, "integrations.manage");
    assertFeatureAvailable(request.plan!, "ACCOUNTING_INTEGRATIONS");
    reply.send(await listAccountingConnections(request.businessId!));
  });

  fastify.post<{ Params: { provider: string } }>("/connections/:provider/authorize", async (request, reply) => {
    requireCapability(request, "integrations.manage");
    assertFeatureAvailable(request.plan!, "ACCOUNTING_INTEGRATIONS");
    const { provider } = providerParamSchema.parse(request.params);
    const { redirectUri } = authorizeBodySchema.parse(request.body);
    reply.send(await beginAccountingConnection(request.businessId!, provider, redirectUri));
  });

  fastify.post<{ Params: { provider: string } }>("/connections/:provider/callback", async (request, reply) => {
    requireCapability(request, "integrations.manage");
    assertFeatureAvailable(request.plan!, "ACCOUNTING_INTEGRATIONS");
    const { provider } = providerParamSchema.parse(request.params);
    const body = callbackBodySchema.parse(request.body);
    reply.send(await completeAccountingConnection(request.businessId!, provider, body));
  });

  fastify.post<{ Params: { provider: string } }>("/connections/:provider/disconnect", async (request, reply) => {
    requireCapability(request, "integrations.manage");
    assertFeatureAvailable(request.plan!, "ACCOUNTING_INTEGRATIONS");
    const { provider } = providerParamSchema.parse(request.params);
    reply.send(await disconnectAccountingConnection(request.businessId!, provider));
  });
}
