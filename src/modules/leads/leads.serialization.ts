import type { Lead } from "@prisma/client";

/**
 * Prisma's Decimal fields serialize to JSON as strings. Coerce estimatedValue
 * to a number so every lead payload (raw lead responses, customer profile
 * lead history, dashboard aggregates) has a consistent numeric type.
 */
export function toApiLead<T extends Lead>(lead: T) {
  return {
    ...lead,
    estimatedValue: lead.estimatedValue === null ? null : Number(lead.estimatedValue),
    paidAmount: lead.paidAmount === null ? null : Number(lead.paidAmount),
  };
}
