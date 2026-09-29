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
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/messages/${uuid}`), "GET").path, `/messages/conversations/${uuid}`);
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/messages/send"), "POST").path, "/messages/send");
  assert.equal(internals.matchProtectedRoute(new URL(`https://a/v1/business/messages/${uuid}/read`), "POST").path, `/messages/conversations/${uuid}/read`);
  // "send" is not a conversation id and must not hit the parameterised GET
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/messages/send"), "GET"), null);
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

// --- Legal acceptance at sign-in ---------------------------------------------
// Stubs the network: Turnstile always passes, the backend answers from `routes`.
function stubNetwork(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "challenges.cloudflare.com") {
      const token = new URLSearchParams(String(init.body)).get("response");
      return Response.json({ success: true, action: token, hostname: "chakusarecovery.com" });
    }
    const key = `${init.method || "GET"} ${url.pathname}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[key];
    const [status, body] = handler ? handler() : [404, {}];
    return Response.json(body, { status });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const env = { API_BASE_URL: "https://api.test", TURNSTILE_SECRET: "test" };
const session = { accessToken: "access.jwt", refreshToken: "refresh.token", expiresIn: 900, user: { id: "u1" } };
function signIn(path, body) {
  return worker.fetch(new Request(`https://auth.chakusarecovery.com${path}`, {
    method: "POST",
    headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site", "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env);
}
const googleBody = (extra = {}) => ({ realm: "client", idToken: "x".repeat(40), flow: "login", turnstileToken: "chakusa_login", ...extra });
const passwordBody = (extra = {}) => ({ realm: "client", email: "a@b.co", password: "pw", turnstileToken: "chakusa_login", ...extra });

test("Google sign-in without acceptance is refused and revoked while documents are pending", async () => {
  const net = stubNetwork({
    "POST /customer/auth/google": () => [200, { ...session, isNewUser: true }],
    "GET /customer/legal/status": () => [200, { pending: [{ type: "TERMS_OF_SERVICE" }] }],
    "POST /customer/auth/logout": () => [200, {}],
  });
  try {
    const response = await signIn("/v1/google", googleBody());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "LEGAL_ACCEPTANCE_REQUIRED");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!net.calls.some((call) => call.key === "POST /customer/legal/accept"), "no acceptance may be recorded without the box ticked");
    assert.deepEqual(net.calls.find((call) => call.key === "POST /customer/auth/logout").body, { refreshToken: "refresh.token" });
  } finally { net.restore(); }
});

test("Google sign-in with the box ticked records each document and opens a session", async () => {
  let accepted = 0;
  const net = stubNetwork({
    "POST /customer/auth/google": () => [200, session],
    "POST /customer/legal/accept": () => { accepted += 1; return [201, { id: "e" }]; },
    "GET /customer/legal/status": () => [200, { pending: accepted === 3 ? [] : [{ type: "TERMS_OF_SERVICE" }] }],
  });
  try {
    const response = await signIn("/v1/google", googleBody({ acceptedLegal: true }));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("set-cookie"));
    const sources = net.calls.filter((call) => call.key === "POST /customer/legal/accept").map((call) => call.body.source);
    assert.deepEqual(sources, ["website_google_auth", "website_google_auth", "website_google_auth"]);
  } finally { net.restore(); }
});

test("returning users with nothing pending sign in without recording a new acceptance", async () => {
  const net = stubNetwork({
    "POST /customer/auth/login": () => [200, session],
    "GET /customer/legal/status": () => [200, { pending: [] }],
  });
  try {
    const response = await signIn("/v1/login", passwordBody());
    assert.equal(response.status, 200);
    assert.ok(!net.calls.some((call) => call.key === "POST /customer/legal/accept"));
  } finally { net.restore(); }
});

test("password sign-in with pending documents is refused until accepted", async () => {
  const net = stubNetwork({
    "POST /customer/auth/login": () => [200, session],
    "GET /customer/legal/status": () => [200, { pending: [{ type: "PRIVACY_POLICY" }] }],
    "POST /customer/auth/logout": () => [200, {}],
  });
  try {
    const response = await signIn("/v1/login", passwordBody());
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally { net.restore(); }
});

test("an unreachable legal status fails closed without a session", async () => {
  const net = stubNetwork({
    "POST /customer/auth/login": () => [200, session],
    "GET /customer/legal/status": () => [503, {}],
    "POST /customer/auth/logout": () => [200, {}],
  });
  try {
    const response = await signIn("/v1/login", passwordBody());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(net.calls.some((call) => call.key === "POST /customer/auth/logout"));
  } finally { net.restore(); }
});
