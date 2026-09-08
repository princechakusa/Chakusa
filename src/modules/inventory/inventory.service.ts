import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { deriveBalance, isLowStock, roundQuantity, signedDelta, type MovementKind } from "../../lib/inventory/inventory.domain.js";
import type { CreateInventoryItemInput, CreateMovementInput, UpdateInventoryItemInput } from "./inventory.schemas.js";

const ZERO = new Prisma.Decimal(0);

function serializeItem(row: { id: string; name: string; sku: string | null; unit: string | null; lowStockThreshold: Prisma.Decimal | null; allowNegative: boolean; active: boolean; createdAt: Date; updatedAt: Date }, balance: Prisma.Decimal) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.unit,
    lowStockThreshold: row.lowStockThreshold == null ? null : row.lowStockThreshold.toFixed(3),
    allowNegative: row.allowNegative,
    active: row.active,
    currentStock: balance.toFixed(3),
    lowStock: isLowStock(balance, row.lowStockThreshold),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMovement(row: { id: string; kind: MovementKind; quantityDelta: Prisma.Decimal; balanceAfter: Prisma.Decimal; reason: string | null; reference: string | null; appointmentId: string | null; createdByUserId: string; createdAt: Date }) {
  return {
    id: row.id,
    kind: row.kind,
    quantityDelta: row.quantityDelta.toFixed(3),
    balanceAfter: row.balanceAfter.toFixed(3),
    reason: row.reason,
    reference: row.reference,
    appointmentId: row.appointmentId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function balancesByItem(businessId: string, itemIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (!itemIds.length) return new Map();
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["itemId"],
    where: { businessId, itemId: { in: itemIds } },
    _sum: { quantityDelta: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const id of itemIds) map.set(id, ZERO);
  for (const g of grouped) map.set(g.itemId, roundQuantity(g._sum.quantityDelta ?? ZERO));
  return map;
}

export async function listInventoryItems(businessId: string, includeInactive: boolean) {
  const items = await prisma.inventoryItem.findMany({
    where: { businessId, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const balances = await balancesByItem(businessId, items.map(i => i.id));
  return items.map(i => serializeItem(i, balances.get(i.id) ?? ZERO));
}

export async function getInventoryItem(businessId: string, id: string) {
  const item = await prisma.inventoryItem.findFirst({ where: { id, businessId } });
  if (!item) throw ApiError.notFound("Inventory item not found");
  const [balances, movements] = await Promise.all([
    balancesByItem(businessId, [id]),
    prisma.inventoryMovement.findMany({ where: { businessId, itemId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { ...serializeItem(item, balances.get(id) ?? ZERO), movements: movements.map(serializeMovement) };
}

export async function createInventoryItem(businessId: string, actorUserId: string, input: CreateInventoryItemInput) {
  return prisma.$transaction(async tx => {
    const clash = await tx.inventoryItem.findFirst({ where: { businessId, name: input.name }, select: { id: true } });
    if (clash) throw ApiError.conflict("An inventory item with that name already exists");
    const item = await tx.inventoryItem.create({
      data: {
        businessId,
        name: input.name,
        sku: input.sku ?? null,
        unit: input.unit ?? null,
        lowStockThreshold: input.lowStockThreshold == null ? null : new Prisma.Decimal(input.lowStockThreshold),
        allowNegative: input.allowNegative ?? false,
        createdByUserId: actorUserId,
      },
    });
    let balance = ZERO;
    if (input.openingQuantity != null) {
      const delta = roundQuantity(new Prisma.Decimal(input.openingQuantity));
      balance = delta;
      await tx.inventoryMovement.create({
        data: { businessId, itemId: item.id, kind: "OPENING", quantityDelta: delta, balanceAfter: delta, reason: "Opening stock", createdByUserId: actorUserId },
      });
    }
    return serializeItem(item, balance);
  }, { isolationLevel: "Serializable" });
}

export async function updateInventoryItem(businessId: string, id: string, input: UpdateInventoryItemInput) {
  const existing = await prisma.inventoryItem.findFirst({ where: { id, businessId }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Inventory item not found");
  if (input.name) {
    const clash = await prisma.inventoryItem.findFirst({ where: { businessId, name: input.name, NOT: { id } }, select: { id: true } });
    if (clash) throw ApiError.conflict("An inventory item with that name already exists");
  }
  const item = await prisma.inventoryItem.update({
    where: { id },
    data: {
      name: input.name,
      sku: input.sku === undefined ? undefined : input.sku,
      unit: input.unit === undefined ? undefined : input.unit,
      lowStockThreshold: input.lowStockThreshold === undefined ? undefined : input.lowStockThreshold === null ? null : new Prisma.Decimal(input.lowStockThreshold),
      allowNegative: input.allowNegative,
      active: input.active,
    },
  });
  const balances = await balancesByItem(businessId, [id]);
  return serializeItem(item, balances.get(id) ?? ZERO);
}

export async function listItemMovements(businessId: string, itemId: string, limit: number) {
  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, businessId }, select: { id: true } });
  if (!item) throw ApiError.notFound("Inventory item not found");
  const movements = await prisma.inventoryMovement.findMany({ where: { businessId, itemId }, orderBy: { createdAt: "desc" }, take: limit });
  return movements.map(serializeMovement);
}

export async function recordMovement(businessId: string, actorUserId: string, itemId: string, input: CreateMovementInput) {
  // Read Committed (the default), not Serializable: the transaction-scoped
  // advisory lock below already guarantees that at most one movement for this
  // item is in flight at a time, so there is no lost-update or negative-stock
  // race to guard against — and Read Committed lets the post-lock balance read
  // see every already-committed movement, which a Serializable snapshot taken
  // at BEGIN would miss (causing spurious 40001 aborts under contention).
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory:${businessId}:${itemId}`}))`;

    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, businessId } });
    if (!item) throw ApiError.notFound("Inventory item not found");
    if (!item.active) throw ApiError.conflict("This inventory item is inactive. Reactivate it to record movements.");

    if (input.kind === "SERVICE_USE") {
      const appointment = await tx.appointment.findFirst({ where: { id: input.appointmentId!, businessId }, select: { id: true } });
      if (!appointment) throw ApiError.badRequest("appointmentId does not belong to this business");
    }

    const priorRows = await tx.inventoryMovement.findMany({ where: { businessId, itemId }, select: { quantityDelta: true } });
    const current = deriveBalance(priorRows.map(r => r.quantityDelta));
    const delta = signedDelta(input.kind as MovementKind, input.quantity, input.direction);
    const balanceAfter = roundQuantity(current.plus(delta));
    if (balanceAfter.lt(0) && !item.allowNegative) {
      throw ApiError.badRequest(`Not enough stock: ${current.toFixed(3)} available, movement would leave ${balanceAfter.toFixed(3)}`);
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        businessId,
        itemId,
        kind: input.kind,
        quantityDelta: delta,
        balanceAfter,
        reason: input.reason ?? null,
        reference: input.reference ?? null,
        appointmentId: input.kind === "SERVICE_USE" ? input.appointmentId! : null,
        createdByUserId: actorUserId,
      },
    });
    return { movement: serializeMovement(movement), currentStock: balanceAfter.toFixed(3), lowStock: isLowStock(balanceAfter, item.lowStockThreshold) };
  }, { timeout: 20_000, maxWait: 20_000 });
}
