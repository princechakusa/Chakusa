import { describe, expect, it } from "vitest";
import { buildCorsAllowedOrigins } from "../src/lib/corsOrigins.js";

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
