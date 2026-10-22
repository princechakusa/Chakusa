import { afterEach, describe, expect, it } from "vitest";
import { publicWebOrigin, setPublicWebOrigin } from "../src/lib/publicWebOrigin.js";
import { buildShareUrl } from "../src/lib/marketplace/discovery.js";
import { buildPublicBookingUrl } from "../src/lib/publicBookingLinks.js";
import { config } from "../src/lib/config.js";

describe("public web origin (shop, booking and review links)", () => {
  afterEach(() => setPublicWebOrigin(null));

  it("uses the admin Website setting once loaded, over PUBLIC_REVIEW_BASE_URL", () => {
    setPublicWebOrigin("https://chakusarecovery.com/");
    expect(publicWebOrigin()).toBe("https://chakusarecovery.com");
    expect(buildShareUrl("salon-a")).toBe("https://chakusarecovery.com/b/salon-a");
    expect(buildPublicBookingUrl("salon-a")).toBe("https://chakusarecovery.com/book/salon-a");
  });

  it("ignores a non-https value and falls back to the env setting", () => {
    setPublicWebOrigin("http://insecure.example");
    expect(publicWebOrigin()).toBe(config.PUBLIC_REVIEW_BASE_URL?.replace(/\/+$/, ""));
  });

  it("never invents a domain: unset means the local dev origin", () => {
    if (config.PUBLIC_REVIEW_BASE_URL) return;
    expect(buildShareUrl("x")).toBe("http://localhost:19006/b/x");
  });
});
