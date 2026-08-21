import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { createReviewRequestSchema, updateReviewRequestSchema } from "./reviews.schemas.js";
import {
  listReviewRequests,
  createReviewRequest,
  getReviewRequest,
  updateReviewRequest,
  generateReviewMessage,
  generatePublicReviewLink,
  bulkCreateReviewRequests,
  bulkSendReviewRequests,
  markReviewRequestOpened,
  markReviewRequestSent,
  markReviewRequestReviewed,
  markReviewRequestFeedbackReceived,
} from "./reviews.service.js";

export default async function reviewRequestRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    reply.send(await listReviewRequests(request.businessId!));
  });

  fastify.post("/", async (request, reply) => {
    const input = createReviewRequestSchema.parse(request.body);
    const created = await createReviewRequest(request.businessId!, request.user.userId, input, request.plan!);
    reply.status(201).send(created);
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    reply.send(await getReviewRequest(request.businessId!, request.params.id));
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const input = updateReviewRequestSchema.parse(request.body);
    reply.send(await updateReviewRequest(request.businessId!, request.params.id, input));
  });

  fastify.post<{ Params: { id: string } }>("/:id/generate-message", async (request, reply) => {
    reply.send(await generateReviewMessage(request.businessId!, request.params.id));
  });

  // Marketing module's "Review campaign" — available on every plan,
  // creates and prepares messages only. See bulk-send below for Pro+.
  fastify.post("/bulk-create", async (request, reply) => {
    reply.send(await bulkCreateReviewRequests(request.businessId!, request.user.userId, request.plan!));
  });

  fastify.post("/bulk-send", async (request, reply) => {
    reply.send(
      await bulkSendReviewRequests(request.businessId!, request.user.userId, request.plan!, request.status!),
    );
  });

  // Mints/re-mints the public link token — see generatePublicReviewLink's
  // doc comment for why this always issues a fresh token. The response
  // includes the raw token (only ever visible here); the caller is
  // responsible for building the actual customer-facing URL (see the
  // Phase report for the recommended path contract) and embedding it
  // wherever they choose to send it.
  fastify.post<{ Params: { id: string } }>("/:id/public-link", async (request, reply) => {
    reply.send(await generatePublicReviewLink(request.businessId!, request.params.id));
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-opened", async (request, reply) => {
    reply.send(
      await markReviewRequestOpened(request.businessId!, request.user.userId, request.params.id),
    );
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-sent", async (request, reply) => {
    reply.send(await markReviewRequestSent(request.businessId!, request.user.userId, request.params.id));
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-reviewed", async (request, reply) => {
    reply.send(
      await markReviewRequestReviewed(request.businessId!, request.user.userId, request.params.id),
    );
  });

  fastify.post<{ Params: { id: string } }>(
    "/:id/mark-feedback-received",
    async (request, reply) => {
      // Wrap the standalone transition in its own transaction so the
      // ownership check, claimed status update, activity insertion, and
      // final read are all atomic — matching the guarantee createFeedback
      // already gets by passing its own transaction client through.
      const reviewRequest = await prisma.$transaction((tx) =>
        markReviewRequestFeedbackReceived(
          request.businessId!,
          request.user.userId,
          request.params.id,
          tx,
        ),
      );
      reply.send(reviewRequest);
    },
  );
}
