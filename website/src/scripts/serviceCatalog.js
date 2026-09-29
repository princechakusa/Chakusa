// Pure helpers for the web service catalogue (dashboard/business/services).
// Usability only: the backend (src/modules/services/services.schemas.ts)
// re-validates everything and enforces catalog.manage. The unit tests in
// tests/web-service-catalog.test.ts parse these payloads with the backend
// schemas.
import { isUuid } from "./salesDocuments.js";

const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const WHOLE = /^\d{1,4}$/;
const text = (value) => (typeof value === "string" ? value.trim() : "");

/** Returns a user-facing problem, or null. */
export function validateServiceForm(fields) {
  const name = text(fields.name);
  if (!name) return "Enter a service name.";
  if (name.length > 120) return "The name is too long (120 characters max).";
  if (text(fields.description).length > 500) return "The description is too long (500 characters max).";
  if (text(fields.category).length > 80) return "The category is too long (80 characters max).";
  const minutes = (value, min, max, what) => {
    const raw = text(value);
    if (!WHOLE.test(raw) || Number(raw) < min || Number(raw) > max) return `${what} must be a whole number of minutes from ${min} to ${max}.`;
    return null;
  };
  const durationProblem = minutes(fields.durationMinutes, 5, 1440, "Duration");
  if (durationProblem) return durationProblem;
  const prepProblem = minutes(fields.preparationMinutes || "0", 0, 240, "Preparation time");
  if (prepProblem) return prepProblem;
  const cleanupProblem = minutes(fields.cleanupMinutes || "0", 0, 240, "Clean-up time");
  if (cleanupProblem) return cleanupProblem;
  const price = text(fields.price);
  if (price && !AMOUNT.test(price)) return "Price must be an amount like 40 or 40.50.";
  const deposit = text(fields.depositAmount);
  if (deposit && !AMOUNT.test(deposit)) return "Deposit must be an amount like 10 or 10.00.";
  if (deposit && !price) return "Set a price before adding a deposit.";
  if (deposit && price && Number(deposit) > Number(price)) return "The deposit cannot be more than the price.";
  const sort = text(fields.sortOrder || "0");
  if (!/^\d{1,5}$/.test(sort) || Number(sort) > 10000) return "Display order must be a whole number from 0 to 10000.";
  if ((fields.memberIds ?? []).some((id) => !isUuid(id))) return "Choose team members from the list.";
  return null;
}

/** Full body for create or update (update always sends every field so the saved service matches the form). */
export function buildServicePayload(fields) {
  const optional = (value) => (text(value) ? text(value) : null);
  const amount = (value) => (text(value) ? Number(text(value)) : null);
  return {
    name: text(fields.name),
    description: optional(fields.description),
    category: optional(fields.category),
    durationMinutes: Number(text(fields.durationMinutes)),
    preparationMinutes: Number(text(fields.preparationMinutes) || 0),
    cleanupMinutes: Number(text(fields.cleanupMinutes) || 0),
    price: amount(fields.price),
    depositAmount: amount(fields.depositAmount),
    active: fields.active !== false,
    publiclyBookable: fields.publiclyBookable !== false,
    sortOrder: Number(text(fields.sortOrder) || 0),
    memberIds: [...new Set((fields.memberIds ?? []).filter(isUuid))],
  };
}
