import { describe, expect, it } from "vitest";
import { redactLocationFromUrl } from "../src/lib/requestLogging.js";

describe("request log redaction", () => {
  it("redacts a customer's coordinates from logged URLs", () => {
    expect(redactLocationFromUrl("/customer/marketplace/nearby?lat=-17.8292&lng=31.0522&radiusKm=15&limit=30"))
      .toBe("/customer/marketplace/nearby?lat=[redacted]&lng=[redacted]&radiusKm=15&limit=30");
    expect(redactLocationFromUrl("/x?LATITUDE=1&Longitude=2&lon=3&q=barber"))
      .toBe("/x?LATITUDE=[redacted]&Longitude=[redacted]&lon=[redacted]&q=barber");
  });
  it("leaves other URLs alone", () => {
    expect(redactLocationFromUrl("/customer/marketplace?category=hair")).toBe("/customer/marketplace?category=hair");
    expect(redactLocationFromUrl("/health")).toBe("/health");
    expect(redactLocationFromUrl("/x?%E0%A4%A=1")).toBe("/x?%E0%A4%A=1");
  });
});
