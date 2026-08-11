import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ApiError } from "../lib/errors.js";

export default fp(async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | ApiError | ZodError, request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.flatten(),
        },
      });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        reply.status(409).send({
          error: { code: "CONFLICT", message: "Resource already exists" },
        });
        return;
      }
      if (error.code === "P2025") {
        reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Resource not found" },
        });
        return;
      }
    }

    // Fastify's own validation (schema-based) errors
    if ("validation" in error && error.validation) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message },
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
});
