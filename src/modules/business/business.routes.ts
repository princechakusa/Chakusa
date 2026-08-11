import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { updateBusinessSchema, createBusinessSchema } from "./business.schemas.js";

export default async function businessRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/", { preHandler: fastify.requireBusiness }, async (request, reply) => {
    const business = await prisma.business.findUnique({ where: { id: request.businessId } });
    if (!business) throw ApiError.notFound("Business not found");
    reply.send(business);
  });

  // MVP: one business per user, created during registration. This allows
  // creating an additional business for a user with no existing membership.
  fastify.post("/", async (request, reply) => {
    const input = createBusinessSchema.parse(request.body);
    const userId = request.user.userId;

    const existing = await prisma.businessMember.findFirst({ where: { userId } });
    if (existing) {
      throw ApiError.conflict("User already belongs to a business");
    }

    const business = await prisma.$transaction(async (tx) => {
      const created = await tx.business.create({
        data: { ownerId: userId, name: input.name, industry: input.industry, phone: input.phone },
      });
      await tx.businessMember.create({
        data: { businessId: created.id, userId, role: "OWNER" },
      });
      return created;
    });

    reply.status(201).send(business);
  });

  fastify.patch("/", { preHandler: fastify.requireBusiness }, async (request, reply) => {
    const input = updateBusinessSchema.parse(request.body);

    const business = await prisma.business.update({
      where: { id: request.businessId },
      data: {
        name: input.name,
        industry: input.industry,
        phone: input.phone,
        googleReviewLink: input.googleReviewLink,
        workingHours: input.workingHours as Prisma.InputJsonValue | undefined,
        defaultServices: input.defaultServices as Prisma.InputJsonValue | undefined,
        reminderDays: input.reminderDays,
        preferredTone: input.preferredTone,
      },
    });

    reply.send(business);
  });
}
