import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuerySchema,
  bulkImportCustomersSchema,
  customerTagSchema,
  customerTagAssignmentsSchema,
} from "./customers.schemas.js";
import {
  listCustomers,
  createCustomer,
  getCustomerProfile,
  updateCustomer,
  bulkImportCustomers,
} from "./customers.service.js";
import { customerCsvPreviewSchema } from "./customers.schemas.js";
import { parseCustomerCsv, validateCustomerCsvRows } from "./customerCsv.js";
import { createCustomerTag, getAudienceCenter, setCustomerTags } from "./audiences.service.js";

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

  fastify.post("/bulk-import/preview", async (request, reply) => {
    const { csv } = customerCsvPreviewSchema.parse(request.body);
    const parsed = parseCustomerCsv(csv);
    if (parsed.errors.length) return reply.send({ valid: false, errors: parsed.errors, rows: [] });
    const validated = validateCustomerCsvRows(parsed.rows);
    if (!validated.input) return reply.send({ valid: false, errors: validated.errors, rows: [] });
    const existingPhones = new Set((await prisma.customer.findMany({ where: { businessId: request.businessId!, phoneE164: { not: null } }, select: { phoneE164: true } })).map(customer => customer.phoneE164));
    return reply.send({ valid: true, errors: [], rows: validated.input.customers, existingCustomerCount: existingPhones.size });
  });

  fastify.get("/audiences", async (request, reply) => reply.send(await getAudienceCenter(request.businessId!)));
  fastify.post("/tags", async (request, reply) => reply.status(201).send(await createCustomerTag(request.businessId!, customerTagSchema.parse(request.body).name)));
  fastify.patch<{ Params: { id: string } }>("/:id/tags", async (request, reply) => reply.send(await setCustomerTags(request.businessId!, request.params.id, customerTagAssignmentsSchema.parse(request.body).tagIds)));

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
