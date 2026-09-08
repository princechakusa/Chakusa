import { Prisma } from "@prisma/client";

// Inventory #13 — pure ledger arithmetic. No I/O.
//
// Current stock is ALWAYS the sum of quantityDelta over an item's movements.
// Nothing here mutates a stored quantity; callers persist immutable movement
// rows and the running balanceAfter snapshot in one serialized transaction.

export type MovementKind =
  | "OPENING" | "RECEIVE" | "RESTOCK"
  | "CONSUME" | "SERVICE_USE" | "WASTE"
  | "ADJUST" | "CORRECTION";

export type AdjustDirection = "increase" | "decrease";

const INCREASE_KINDS = new Set<MovementKind>(["OPENING", "RECEIVE", "RESTOCK"]);
const DECREASE_KINDS = new Set<MovementKind>(["CONSUME", "SERVICE_USE", "WASTE"]);
const SIGNED_KINDS = new Set<MovementKind>(["ADJUST", "CORRECTION"]);

const THREE_DP = 3;
const round3 = (v: Prisma.Decimal) => v.toDecimalPlaces(THREE_DP, Prisma.Decimal.ROUND_HALF_UP);
const toDecimal = (v: Prisma.Decimal | string | number): Prisma.Decimal =>
  v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);

/**
 * The signed change this movement applies to stock. `quantity` is always a
 * positive magnitude; the sign comes from the kind, except ADJUST / CORRECTION
 * which need an explicit direction.
 */
export function signedDelta(kind: MovementKind, quantity: Prisma.Decimal | string | number, direction?: AdjustDirection): Prisma.Decimal {
  const magnitude = round3(toDecimal(quantity));
  if (magnitude.lte(0)) throw new Error("quantity must be a positive magnitude");
  if (INCREASE_KINDS.has(kind)) return magnitude;
  if (DECREASE_KINDS.has(kind)) return magnitude.negated();
  if (SIGNED_KINDS.has(kind)) {
    if (!direction) throw new Error(`${kind} requires a direction`);
    return direction === "increase" ? magnitude : magnitude.negated();
  }
  throw new Error(`unknown movement kind ${kind}`);
}

/** Balance derived purely from the ledger — the authoritative definition of "current stock". */
export function deriveBalance(deltas: readonly (Prisma.Decimal | string | number)[]): Prisma.Decimal {
  return round3(deltas.reduce<Prisma.Decimal>((sum, d) => sum.plus(toDecimal(d)), new Prisma.Decimal(0)));
}

export function isLowStock(balance: Prisma.Decimal | string | number, threshold: Prisma.Decimal | string | number | null | undefined): boolean {
  if (threshold == null) return false;
  return toDecimal(balance).lte(toDecimal(threshold));
}

export { round3 as roundQuantity };
