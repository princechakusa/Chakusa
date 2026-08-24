import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner } from "../../lib/authorization.js";
import {
  createAppointmentPaymentLink,
  createConnectLink,
  connectStatus,
  listAppointmentPayments,
  refundPayment,
} from "./payments.service.js";
import { paymentLinkSchema, refundSchema } from "./payments.schemas.js";
import {
  defaultStripePaymentProvider,
  type StripePaymentProvider,
} from "../../lib/payments/stripeProvider.js";
const idParams = z.object({ id: z.string().uuid() });
export interface PaymentRoutesOptions {
  provider?: StripePaymentProvider;
}
export default async function paymentRoutes(
  fastify: FastifyInstance,
  options: PaymentRoutesOptions = {},
) {
  const provider = options.provider ?? defaultStripePaymentProvider;
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.post("/connect/link", async (request, reply) => {
    requireOwner(request);
    reply.send(await createConnectLink(request.businessId!, provider));
  });
  fastify.get("/connect/status", async (request, reply) =>
    reply.send(await connectStatus(request.businessId!, provider)),
  );
  fastify.post("/appointments/:id/link", async (request, reply) =>
    reply
      .status(201)
      .send(
        await createAppointmentPaymentLink(
          request.businessId!,
          idParams.parse(request.params).id,
          paymentLinkSchema.parse(request.body).kind,
          provider,
        ),
      ),
  );
  fastify.get("/appointments/:id", async (request, reply) =>
    reply.send(
      await listAppointmentPayments(
        request.businessId!,
        idParams.parse(request.params).id,
      ),
    ),
  );
  fastify.post("/:id/refund", async (request, reply) => {
    requireOwner(request);
    reply.send(
      await refundPayment(
        request.businessId!,
        idParams.parse(request.params).id,
        refundSchema.parse(request.body).amount,
        provider,
      ),
    );
  });
}
