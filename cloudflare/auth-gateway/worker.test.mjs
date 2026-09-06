import assert from "node:assert/strict";
import test from "node:test";
import worker, { internals } from "./worker.mjs";

test("refresh cookie keeps realm, persistence, and opaque token", () => {
  const value = internals.encodeRefreshCookie("business", "family.secret.part", true);
  assert.deepEqual(internals.decodeRefreshCookie(value), { realm: "business", refreshToken: "family.secret.part", remember: true });
});

test("access cookie keeps realm and short-lived JWT separate", () => {
  const value = internals.encodeAccessCookie("client", "header.payload.signature");
  assert.deepEqual(internals.decodeAccessCookie(value), { realm: "client", accessToken: "header.payload.signature" });
});

test("malformed cookies are rejected", () => {
  assert.equal(internals.decodeRefreshCookie("x0:anything"), null);
  assert.equal(internals.decodeRefreshCookie("b0:"), null);
  assert.equal(internals.decodeAccessCookie("x:anything"), null);
  assert.equal(internals.decodeAccessCookie(null), null);
});

test("all authentication tokens are removed from browser payloads", () => {
  assert.deepEqual(internals.safeAuthPayload({ accessToken: "short", token: "short", refreshToken: "secret", expiresIn: 900, tokenType: "Bearer", user: { id: "1" } }), { user: { id: "1" } });
});

test("client and business authentication stay on separate backend routes", () => {
  assert.equal(internals.authPath("client", "register"), "/customer/auth/register");
  assert.equal(internals.authPath("business", "refresh"), "/auth/refresh");
});

test("protected routes reject requests without the exact website origin", async () => {
  const response = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/dashboard"), {});
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("cross-site browser contexts are rejected before authentication", async () => {
  const response = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/dashboard", { headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "cross-site" } }), {});
  assert.equal(response.status, 403);
});
