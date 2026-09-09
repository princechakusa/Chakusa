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

test("dashboard proxy uses only explicit realm-scoped routes and approved query keys", () => {
  const route = internals.matchProtectedRoute(new URL("https://auth.example/v1/business/customers?page=2&admin=true&search=Sam"), "GET");
  assert.equal(route.realm, "business");
  assert.equal(route.path, "/customers?search=Sam&page=2");
  assert.equal(internals.matchProtectedRoute(new URL("https://auth.example/v1/business/payments/refunds"), "POST"), null);
});

test("an allowed protected route still rejects a missing session", async () => {
  const response = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/business/customers", { headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site" } }), {});
  assert.equal(response.status, 401);
});

test("#22 new business routes map to the right upstreams and honour method", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/ai-receptionist"), "GET").path, "/ai/receptionist");
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/ai-receptionist"), "PATCH").path, "/ai/receptionist");
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/inventory?includeInactive=true&evil=1"), "GET").path, "/inventory/items?includeInactive=true");
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/inventory"), "POST").path, "/inventory/items");
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/inventory/${uuid}/movements`), "POST").path, `/inventory/items/${uuid}/movements`);
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/feedback/${uuid}/respond`), "POST").path, `/feedback/${uuid}/respond`);
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/leads/${uuid}`), "PATCH").path, `/leads/${uuid}`);
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/appointments/${uuid}/status`), "POST").path, `/appointments/${uuid}/status`);
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/reviews/metrics"), "GET").path, "/review-requests/metrics");
});

test("#22 new routes reject bad shapes and wrong realm", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  // non-uuid id must not match a parameterised route
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/inventory/not-a-uuid/movements"), "POST"), null);
  // wrong method on a real path
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/ai-receptionist"), "DELETE"), null);
  // a business route can never be reached in the client realm
  const route = internals.matchProtectedRoute(new URL("https://a/v1/business/inventory"), "GET");
  assert.equal(route.realm, "business");
  // no generic passthrough — an un-listed inventory sub-path is not routed
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/inventory/${uuid}/audit`), "GET"), null);
});

test("#22 new protected routes still reject a missing session", async () => {
  for (const [path, method] of [["/v1/business/inventory", "GET"], ["/v1/business/ai-receptionist", "GET"], ["/v1/business/reviews/metrics", "GET"]]) {
    const response = await worker.fetch(new Request(`https://auth.chakusarecovery.com${path}`, { method, headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site" } }), {});
    assert.equal(response.status, 401);
  }
});
