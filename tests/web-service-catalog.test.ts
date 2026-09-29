import { describe, expect, it } from "vitest";
import { createServiceOfferingSchema, updateServiceOfferingSchema } from "../src/modules/services/services.schemas.js";
// Web service-catalogue helpers (usability only; the backend re-validates
// and enforces catalog.manage). Payloads must parse with the backend schemas.
import { buildServicePayload, validateServiceForm } from "../website/src/scripts/serviceCatalog.js";

const MEMBER = "11111111-2222-4333-8444-555555555555";
const base = (overrides = {}) => ({ name: "Skin fade", category: "Haircuts", description: "", durationMinutes: "45", preparationMinutes: "5", cleanupMinutes: "10", price: "30", depositAmount: "10", sortOrder: "2", active: true, publiclyBookable: true, memberIds: [MEMBER], ...overrides });

describe("web service catalogue", () => {
  it("builds create and update bodies the backend accepts", () => {
    const body = buildServicePayload(base());
    expect(createServiceOfferingSchema.parse(body)).toMatchObject({ name: "Skin fade", durationMinutes: 45, price: 30, depositAmount: 10, memberIds: [MEMBER] });
    expect(updateServiceOfferingSchema.parse(body).cleanupMinutes).toBe(10);
  });

  it("sends null for an unpriced service and an empty description", () => {
    const body = buildServicePayload(base({ price: "", depositAmount: "", description: "  " }));
    expect(body).toMatchObject({ price: null, depositAmount: null, description: null });
    expect(createServiceOfferingSchema.parse(body).price).toBeNull();
  });

  it("drops non-UUID and duplicate staff ids", () => {
    expect(buildServicePayload(base({ memberIds: [MEMBER, MEMBER, "x"] })).memberIds).toEqual([MEMBER]);
  });

  it("accepts a valid form", () => expect(validateServiceForm(base())).toBeNull());
  it.each([
    ["no name", base({ name: " " })],
    ["duration under 5", base({ durationMinutes: "4" })],
    ["duration over a day", base({ durationMinutes: "1441" })],
    ["fractional duration", base({ durationMinutes: "30.5" })],
    ["preparation over 240", base({ preparationMinutes: "241" })],
    ["negative price", base({ price: "-1" })],
    ["deposit above price", base({ price: "10", depositAmount: "11" })],
    ["deposit without price", base({ price: "", depositAmount: "5" })],
    ["bad staff id", base({ memberIds: ["abc"] })],
  ])("rejects %s", (_name, fields) => expect(validateServiceForm(fields)).not.toBeNull());
});
