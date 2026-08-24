import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner } from "../../lib/authorization.js";
import { ApiError } from "../../lib/errors.js";
import { createCalendarSubscriptionSchema } from "./calendar.schemas.js";
import { createCalendarSubscription, listCalendarSubscriptions, revokeCalendarSubscription, resolveCalendarFeed } from "./calendar.service.js";

const idParams = z.object({ id: z.string().uuid() });

export default async function calendarRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/subscriptions", async request => {
    requireOwner(request);
    return listCalendarSubscriptions(request.businessId!);
  });
  fastify.post("/subscriptions", async (request, reply) => {
    requireOwner(request);
    const created = await createCalendarSubscription(request.businessId!, createCalendarSubscriptionSchema.parse(request.body));
    const host = request.headers.host;
    const forwardedHeader = request.headers["x-forwarded-proto"];
    const forwardedProtocol = (typeof forwardedHeader === "string" ? forwardedHeader : "").split(",")[0]?.trim() ?? "";
    const protocol = forwardedProtocol === "https" || request.protocol === "https" ? "https" : "http";
    reply.status(201).send({ ...created, feedUrl: `${protocol}://${host}/public/calendar/${created.token}.ics` });
  });
  fastify.post("/subscriptions/:id/revoke", async request => {
    requireOwner(request);
    return revokeCalendarSubscription(request.businessId!, idParams.parse(request.params).id);
  });
}

export async function publicCalendarRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>("/:token.ics", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const feed = await resolveCalendarFeed(request.params.token);
    if (!feed) throw ApiError.notFound("This calendar subscription is invalid or revoked");
    reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "public, max-age=300").send(feed);
  });
}
