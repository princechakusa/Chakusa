import { describe, expect, it } from "vitest";
import { assertFeatureAvailable } from "../src/lib/entitlements.js";
import { ApiError } from "../src/lib/errors.js";

function errorFor(feature: string) {
  try { assertFeatureAvailable("FREE", feature as never); } catch (error) { return error as ApiError; }
  throw new Error("expected FEATURE_NOT_AVAILABLE");
}

describe("feature errors name the cheapest plan that includes the feature", () => {
  it("Pro features say Pro", () => {
    const error = errorFor("ADVANCED_ANALYTICS");
    expect(error.details).toMatchObject({ requiredPlan: "PRO" });
    expect(error.message).toMatch(/Pro plan$/);
  });
  it("Business-only features say Business", () => {
    for (const feature of ["INVOICING", "QUOTES_ESTIMATES", "INVENTORY", "AI_RECEPTIONIST"] as const) {
      const error = errorFor(feature);
      expect(error.details, feature).toMatchObject({ requiredPlan: "BUSINESS" });
      expect(error.message).toMatch(/Business plan$/);
    }
  });
});
