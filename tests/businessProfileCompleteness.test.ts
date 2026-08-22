import { describe, expect, it } from "vitest";
import { computeBusinessProfileCompleteness } from "../src/lib/businessProfileCompleteness.js";

const empty = { industry: null, phone: null, description: null, defaultServices: null, workingHoursSummary: null, googleReviewLink: null };

describe("computeBusinessProfileCompleteness", () => {
  it("returns 0 for a completely blank profile", () => {
    expect(computeBusinessProfileCompleteness(empty)).toBe(0);
  });

  it("returns 1 when every field is filled", () => {
    expect(
      computeBusinessProfileCompleteness({
        industry: "plumbing",
        phone: "+263771234567",
        description: "We fix pipes.",
        defaultServices: ["Leak repair"],
        workingHoursSummary: "Mon-Sat, 9-6",
        googleReviewLink: "https://g.page/r/example",
      }),
    ).toBe(1);
  });

  it("counts a partially filled profile fractionally", () => {
    expect(computeBusinessProfileCompleteness({ ...empty, industry: "plumbing", phone: "+263771234567" })).toBeCloseTo(2 / 6);
  });

  it("treats whitespace-only strings as not filled", () => {
    expect(computeBusinessProfileCompleteness({ ...empty, industry: "   ", description: "" })).toBe(0);
  });

  it("treats an empty services array as not filled", () => {
    expect(computeBusinessProfileCompleteness({ ...empty, defaultServices: [] })).toBe(0);
  });

  it("ignores a non-array defaultServices value rather than throwing", () => {
    expect(computeBusinessProfileCompleteness({ ...empty, defaultServices: "not-an-array" })).toBe(0);
  });
});
