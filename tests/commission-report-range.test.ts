import { describe, expect, it } from "vitest";
import { commissionReportQuerySchema } from "../src/modules/commissions/commissions.schemas.js";

describe("commission report range", () => {
  it("accepts up to one year", () => {
    expect(commissionReportQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
    expect(commissionReportQuerySchema.safeParse({ from: "2024-01-01", to: "2024-12-31" }).success).toBe(true);
  });
  it("rejects a range longer than a year or reversed", () => {
    expect(commissionReportQuerySchema.safeParse({ from: "2020-01-01", to: "2026-01-01" }).success).toBe(false);
    expect(commissionReportQuerySchema.safeParse({ from: "2026-05-01", to: "2026-04-01" }).success).toBe(false);
  });
});
