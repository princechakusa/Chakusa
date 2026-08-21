import type { FastifyInstance } from "fastify";
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
  bulkImportCustomersSchema,
} from "./customers.schemas.js";
import {
  listCustomers,
  createCustomer,
  getCustomerProfile,
  updateCustomer,
  bulkImportCustomers,
} from "./customers.service.js";

export default async function customerRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    const query = listCustomersQuerySchema.parse(request.query);
    const result = await listCustomers(request.businessId!, query);
    reply.send(result);
  });

  fastify.post("/", async (request, reply) => {
    const input = createCustomerSchema.parse(request.body);
    const customer = await createCustomer(request.businessId!, request.user.userId, input, request.plan!);
    reply.status(201).send(customer);
  });

  fastify.post("/bulk-import", async (request, reply) => {
    const input = bulkImportCustomersSchema.parse(request.body);
    const result = await bulkImportCustomers(request.businessId!, request.user.userId, input, request.plan!);
    reply.status(201).send(result);
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const profile = await getCustomerProfile(request.businessId!, request.params.id);
    reply.send(profile);
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const input = updateCustomerSchema.parse(request.body);
    const customer = await updateCustomer(
      request.businessId!,
      request.user.userId,
      request.params.id,
      input,
    );
    reply.send(customer);
  });
}
