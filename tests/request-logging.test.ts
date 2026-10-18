import { describe, expect, it } from "vitest";
import { redactLocationFromUrl, serializeErrorForLog } from "../src/lib/requestLogging.js";

describe("request log redaction", () => {
  it("redacts a customer's coordinates from logged URLs", () => {
    expect(redactLocationFromUrl("/customer/marketplace/nearby?lat=-17.8292&lng=31.0522&radiusKm=15&limit=30"))
      .toBe("/customer/marketplace/nearby?lat=[redacted]&lng=[redacted]&radiusKm=15&limit=30");
    expect(redactLocationFromUrl("/x?LATITUDE=1&Longitude=2&lon=3&q=barber"))
      .toBe("/x?LATITUDE=[redacted]&Longitude=[redacted]&lon=[redacted]&q=[redacted]");
  });
  it("leaves other URLs alone", () => {
    expect(redactLocationFromUrl("/customer/marketplace?category=hair")).toBe("/customer/marketplace?category=hair");
    expect(redactLocationFromUrl("/health")).toBe("/health");
    expect(redactLocationFromUrl("/x?%E0%A4%A=1")).toBe("/x?%E0%A4%A=1");
  });
  it("redacts bearer links and query credentials without removing routing context", () => {
    expect(redactLocationFromUrl("/public/reviews/id.secret?utm_source=sms"))
      .toBe("/public/reviews/[redacted]?utm_source=sms");
    expect(redactLocationFromUrl("/public/quotes/private-token/accept"))
      .toBe("/public/quotes/[redacted]/accept");
    expect(redactLocationFromUrl("/public/invoices/private-token")).toBe("/public/invoices/[redacted]");
    expect(redactLocationFromUrl("/public/team-invites/private-token")).toBe("/public/team-invites/[redacted]");
    expect(redactLocationFromUrl("/public/calendar/private-token.ics")).toBe("/public/calendar/[redacted]");
    expect(redactLocationFromUrl("/callback?%74oken=secret&code=oauth&state=csrf&api_key=key&limit=2"))
      .toBe("/callback?%74oken=[redacted]&code=[redacted]&state=[redacted]&api_key=[redacted]&limit=2");
  });
  it("does not retain customer searches or contact details in query logs", () => {
    const logged = redactLocationFromUrl("/customers?search=private-phone&email=private-email&fullName=private-name&limit=20");
    expect(logged).not.toContain("private-");
    expect(logged).toContain("limit=20");
  });
  it("logs error classifications without raw messages, stacks or SDK payloads", () => {
    const error = Object.assign(new Error("private-token"), { code: "ETIMEDOUT", statusCode: 503, response: { body: "private-customer" } });
    const logged = serializeErrorForLog(error);
    expect(logged).toEqual({ type: "Error", message: "[Redacted]", stack: "", code: "ETIMEDOUT", statusCode: 503 });
    expect(JSON.stringify(logged)).not.toContain("private-");
    expect(serializeErrorForLog("private-token")).toEqual({ type: "Error", message: "[Redacted]", stack: "" });
  });
});
