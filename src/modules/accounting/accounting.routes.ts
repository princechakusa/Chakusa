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

export default async function accountingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

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
