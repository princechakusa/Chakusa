import type { FastifyInstance } from "fastify";
import { requireCapability } from "../../lib/authorization.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import {
  createInventoryItemSchema,
  createMovementSchema,
  inventoryIdParamSchema,
  listItemMovementsQuerySchema,
  listItemsQuerySchema,
  RECONCILING_KINDS,
  updateInventoryItemSchema,
} from "./inventory.schemas.js";
import {
  createInventoryItem,
  getInventoryItem,
  listInventoryItems,
  listItemMovements,
  recordMovement,
  updateInventoryItem,
} from "./inventory.service.js";

// Inventory #13. Two independent gates on every route:
//   entitlement  - assertFeatureAvailable(plan, "INVENTORY")  (Business plan)
//   capability   - requireCapability(...)                      (member's role)
// inventory.view   read stock + ledger        OWNER/ADMIN/STAFF
// inventory.record record in/out movements    OWNER/ADMIN/STAFF
// inventory.adjust ADJUST / CORRECTION rows    OWNER/ADMIN
// inventory.manage create/edit items          OWNER/ADMIN
export default async function inventoryRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.addHook("preHandler", async request => assertFeatureAvailable(request.plan!, "INVENTORY"));

  fastify.get("/items", async (request, reply) => {
    requireCapability(request, "inventory.view");
    const { includeInactive } = listItemsQuerySchema.parse(request.query);
    reply.send(await listInventoryItems(request.businessId!, includeInactive));
  });

  fastify.get("/items/:id", async (request, reply) => {
    requireCapability(request, "inventory.view");
    reply.send(await getInventoryItem(request.businessId!, inventoryIdParamSchema.parse(request.params).id));
  });

  fastify.post("/items", async (request, reply) => {
    requireCapability(request, "inventory.manage");
    const input = createInventoryItemSchema.parse(request.body);
    reply.status(201).send(await createInventoryItem(request.businessId!, request.user.userId, input));
  });

  fastify.patch("/items/:id", async (request, reply) => {
    requireCapability(request, "inventory.manage");
    const input = updateInventoryItemSchema.parse(request.body);
    reply.send(await updateInventoryItem(request.businessId!, inventoryIdParamSchema.parse(request.params).id, input));
  });

  fastify.get("/items/:id/movements", async (request, reply) => {
    requireCapability(request, "inventory.view");
    const { limit } = listItemMovementsQuerySchema.parse(request.query);
    reply.send(await listItemMovements(request.businessId!, inventoryIdParamSchema.parse(request.params).id, limit));
  });

  fastify.post("/items/:id/movements", async (request, reply) => {
    const input = createMovementSchema.parse(request.body);
    requireCapability(request, RECONCILING_KINDS.includes(input.kind) ? "inventory.adjust" : "inventory.record");
    reply.status(201).send(await recordMovement(request.businessId!, request.user.userId, inventoryIdParamSchema.parse(request.params).id, input));
  });
}
