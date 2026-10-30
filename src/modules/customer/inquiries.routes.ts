import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCustomerInquiry, listCustomerInquiries, replyToCustomerInquiry, reportInquiry, sendCustomerInquiry, setInquiryBlocked } from "../../lib/marketplace/inquiries.js";

// "Ask the business" - customer side. authenticateCustomer only; every
// handler is scoped to request.customer.profileId.

const sendLimit = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

export default async function customerInquiryRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  fastify.get("/", async (request) => listCustomerInquiries(request.customer!.profileId));

  fastify.post("/", sendLimit, async (request, reply) => {
    const body = z.object({ slug: z.string().trim().min(1).max(200), body: z.string().max(4000) }).parse(request.body);
    reply.status(201).send(await sendCustomerInquiry(request.customer!.profileId, body.slug, body.body));
  });

  fastify.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return getCustomerInquiry(request.customer!.profileId, id);
  });

  fastify.post("/:id/messages", sendLimit, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { body } = z.object({ body: z.string().max(4000) }).parse(request.body);
    reply.status(201).send(await replyToCustomerInquiry(request.customer!.profileId, id, body));
  });

  // Apple 1.2 / Play UGC: the customer can report a conversation and block the business.
  fastify.post("/:id/report", sendLimit, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z.object({ reason: z.enum(["spam", "inappropriate", "scam", "other"]), detail: z.string().trim().max(1000).optional() }).parse(request.body);
    reply.status(201).send(await reportInquiry(request.customer!.profileId, id, input.reason, input.detail));
  });

  fastify.put("/:id/block", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { blocked } = z.object({ blocked: z.boolean() }).parse(request.body);
    return setInquiryBlocked(request.customer!.profileId, id, blocked);
  });
}
