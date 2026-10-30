import { describe, expect, it } from "vitest";
import { buildCorsAllowedOrigins, isCorsOriginAllowed } from "../src/lib/corsOrigins.js";

describe("buildCorsAllowedOrigins", () => {
  it("always allows the public share-link web origin", () => {
    expect(buildCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: "https://admin.example.com", PUBLIC_REVIEW_BASE_URL: "https://chakusarecovery.com/" })).toEqual(["https://admin.example.com", "https://chakusarecovery.com"]);
  });
  it("adds the admin console origin and removes duplicates", () => {
    expect(buildCorsAllowedOrigins({ CORS_ALLOWED_ORIGINS: "https://a.example, https://a.example", ADMIN_CONSOLE_ORIGIN: "https://admin.example", PUBLIC_REVIEW_BASE_URL: "https://a.example/r" })).toEqual(["https://a.example", "https://admin.example"]);
  });
  it("returns null when nothing is configured and ignores invalid URLs", () => {
    expect(buildCorsAllowedOrigins({})).toBeNull();
    expect(buildCorsAllowedOrigins({ PUBLIC_REVIEW_BASE_URL: "not a url" })).toBeNull();
  });
});

describe("isCorsOriginAllowed", () => {
  const prod = { allowed: ["https://admin.example.com"], publicWebOrigin: "https://chakusarecovery.com", production: true };
  it("allows the public web origin (admin Website setting) and the static list", () => {
    expect(isCorsOriginAllowed("https://chakusarecovery.com", prod)).toBe(true);
    expect(isCorsOriginAllowed("https://admin.example.com", prod)).toBe(true);
  });
  it("refuses any other origin in production", () => {
    expect(isCorsOriginAllowed("https://evil.example", prod)).toBe(false);
    expect(isCorsOriginAllowed("https://evil.example", { allowed: null, publicWebOrigin: undefined, production: true })).toBe(false);
  });
  it("allows requests without an Origin header, and any origin in development when nothing is configured", () => {
    expect(isCorsOriginAllowed(undefined, prod)).toBe(true);
    expect(isCorsOriginAllowed("http://localhost:8081", { allowed: null, publicWebOrigin: undefined, production: false })).toBe(true);
  });
});
