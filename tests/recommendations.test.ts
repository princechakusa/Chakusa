import { describe, expect, it } from "vitest";
import { generateRecommendations } from "../src/lib/recommendations.js";

const noAction = { needingFollowUpCount: 0, customersDueForReviewRequestCount: 0, outstandingRevenue: 0, customersDue: 0, profileCompleteness: 1 };

describe("generateRecommendations", () => {
  it("returns no recommendations when everything is caught up and complete", () => {
    expect(generateRecommendations(noAction)).toEqual([]);
  });

  it("recommends contacting customers when some are awaiting a response", () => {
    const result = generateRecommendations({ ...noAction, needingFollowUpCount: 3 });
    expect(result).toContainEqual({ key: "contact_customers", message: "Contact 3 customers waiting on a response.", severity: "attention" });
  });

  it("uses singular wording for exactly one customer needing follow-up", () => {
    const result = generateRecommendations({ ...noAction, needingFollowUpCount: 1 });
    expect(result.find((r) => r.key === "contact_customers")?.message).toBe("Contact 1 customer waiting on a response.");
  });

  it("recommends requesting reviews when eligible customers exist", () => {
    const result = generateRecommendations({ ...noAction, customersDueForReviewRequestCount: 2 });
    expect(result).toContainEqual({ key: "request_reviews", message: "Request a review from 2 recent customers.", severity: "info" });
  });

  it("recommends collecting outstanding revenue when there is any", () => {
    const result = generateRecommendations({ ...noAction, outstandingRevenue: 150 });
    expect(result.some((r) => r.key === "collect_outstanding_revenue")).toBe(true);
  });

  it("does not recommend collecting revenue when outstanding is zero", () => {
    const result = generateRecommendations({ ...noAction, outstandingRevenue: 0 });
    expect(result.some((r) => r.key === "collect_outstanding_revenue")).toBe(false);
  });

  it("recommends bringing back customers who haven't returned", () => {
    const result = generateRecommendations({ ...noAction, customersDue: 5 });
    expect(result.some((r) => r.key === "bring_back_customers")).toBe(true);
  });

  it("recommends completing the profile when it's below 100%", () => {
    const result = generateRecommendations({ ...noAction, profileCompleteness: 0.5 });
    expect(result.some((r) => r.key === "complete_profile")).toBe(true);
  });

  it("never recommends completing the profile when it's already at 100%", () => {
    const result = generateRecommendations({ ...noAction, profileCompleteness: 1 });
    expect(result.some((r) => r.key === "complete_profile")).toBe(false);
  });

  it("never mentions the Recovery Engine — that is on-device state this module has no access to", () => {
    const result = generateRecommendations({ needingFollowUpCount: 5, customersDueForReviewRequestCount: 5, outstandingRevenue: 500, customersDue: 5, profileCompleteness: 0 });
    expect(result.every((r) => !r.message.toLowerCase().includes("recovery engine"))).toBe(true);
  });

  it("returns multiple recommendations together, in a fixed priority order", () => {
    const result = generateRecommendations({ needingFollowUpCount: 1, customersDueForReviewRequestCount: 1, outstandingRevenue: 100, customersDue: 1, profileCompleteness: 0.5 });
    expect(result.map((r) => r.key)).toEqual(["contact_customers", "request_reviews", "collect_outstanding_revenue", "bring_back_customers", "complete_profile"]);
  });
});
