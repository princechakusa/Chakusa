import { describe, expect, it } from "vitest";
import { extractCloudflareAccessToken } from "../src/lib/cloudflareAccess.js";

describe("extractCloudflareAccessToken", () => {
  it("prefers the Cf-Access-Jwt-Assertion header when present", () => {
    expect(extractCloudflareAccessToken({ headers: { "cf-access-jwt-assertion": "header-token", cookie: "CF_Authorization=cookie-token" } })).toBe("header-token");
  });

  it("falls back to the CF_Authorization cookie", () => {
    expect(extractCloudflareAccessToken({ headers: { cookie: "other=1; CF_Authorization=cookie-token; more=2" } })).toBe("cookie-token");
  });

  it("returns null when neither is present", () => {
    expect(extractCloudflareAccessToken({ headers: {} })).toBeNull();
    expect(extractCloudflareAccessToken({ headers: { cookie: "unrelated=1" } })).toBeNull();
  });
});
