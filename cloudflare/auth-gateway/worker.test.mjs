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
    return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
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

// --- Quotes & invoices (web sales documents) ---------------------------------
test("quote and invoice routes map to the exact backend paths", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  const path = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method)?.path ?? null;
  assert.equal(path("/v1/business/quotes", "POST"), "/quotes");
  assert.equal(path(`/v1/business/quotes/${uuid}`, "GET"), `/quotes/${uuid}`);
  assert.equal(path(`/v1/business/quotes/${uuid}`, "PATCH"), `/quotes/${uuid}`);
  assert.equal(path(`/v1/business/quotes/${uuid}`, "DELETE"), `/quotes/${uuid}`);
  for (const action of ["send", "resend", "revise", "cancel"]) assert.equal(path(`/v1/business/quotes/${uuid}/${action}`, "POST"), `/quotes/${uuid}/${action}`);
  assert.equal(path("/v1/business/invoices", "POST"), "/invoices");
  assert.equal(path(`/v1/business/invoices/from-quote/${uuid}`, "POST"), `/invoices/from-quote/${uuid}`);
  assert.equal(path(`/v1/business/invoices/${uuid}`, "GET"), `/invoices/${uuid}`);
  assert.equal(path(`/v1/business/invoices/${uuid}`, "PATCH"), `/invoices/${uuid}`);
  assert.equal(path(`/v1/business/invoices/${uuid}`, "DELETE"), `/invoices/${uuid}`);
  assert.equal(path(`/v1/business/invoices/${uuid}/payments`, "GET"), `/invoices/${uuid}/payments`);
  for (const action of ["send", "reissue-link", "void", "payment-link"]) assert.equal(path(`/v1/business/invoices/${uuid}/${action}`, "POST"), `/invoices/${uuid}/${action}`);
});

test("sales document routes refuse refunds, unknown actions, bad ids and wrong methods", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  const route = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method);
  // Refunds move money out of the business: never reachable from the web.
  assert.equal(route(`/v1/business/invoices/${uuid}/payments/${uuid}/refund`, "POST"), null);
  assert.equal(route(`/v1/business/invoices/${uuid}/refund`, "POST"), null);
  // Only the named lifecycle actions exist.
  assert.equal(route(`/v1/business/quotes/${uuid}/accept`, "POST"), null);
  assert.equal(route(`/v1/business/invoices/${uuid}/mark-paid`, "POST"), null);
  // Non-UUID ids and traversal-shaped ids never match.
  assert.equal(route("/v1/business/quotes/not-a-uuid", "GET"), null);
  assert.equal(route(`/v1/business/quotes/${uuid}/../../admin`, "GET"), null);
  assert.equal(route("/v1/business/invoices/from-quote/abc", "POST"), null);
  // Lifecycle actions are POST-only; collections are not deletable.
  assert.equal(route(`/v1/business/quotes/${uuid}/send`, "GET"), null);
  assert.equal(route("/v1/business/quotes", "DELETE"), null);
  assert.equal(route("/v1/business/invoices", "DELETE"), null);
  // Business documents are never reachable in the client realm.
  assert.equal(route(`/v1/business/invoices/${uuid}`, "GET").realm, "business");
});

test("delete requests are allowed by CORS preflight and still require a session", async () => {
  const preflight = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/business/quotes/11111111-2222-4333-8444-555555555555", { method: "OPTIONS", headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site" } }), {});
  assert.match(preflight.headers.get("access-control-allow-methods"), /DELETE/);
  const response = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/business/quotes/11111111-2222-4333-8444-555555555555", { method: "DELETE", headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site" } }), {});
  assert.equal(response.status, 401);
});

test("a cross-site delete is rejected before any session lookup", async () => {
  const response = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/business/invoices/11111111-2222-4333-8444-555555555555", { method: "DELETE", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }), {});
  assert.equal(response.status, 403);
});

test("service catalogue writes map exactly and archive is the only delete", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  const route = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method);
  assert.equal(route("/v1/business/services", "POST").path, "/services");
  assert.equal(route(`/v1/business/services/${uuid}`, "PATCH").path, `/services/${uuid}`);
  assert.equal(route(`/v1/business/services/${uuid}`, "DELETE").path, `/services/${uuid}`);
  assert.equal(route("/v1/business/services", "DELETE"), null);
  assert.equal(route("/v1/business/services/not-a-uuid", "PATCH"), null);
  assert.equal(route(`/v1/business/services/${uuid}/members`, "POST"), null);
});

// --- Account settings --------------------------------------------------------
test("API error messages are surfaced from the { error: { message } } shape", () => {
  assert.equal(internals.upstreamErrorMessage({ error: { code: "CONFLICT", message: "Only draft documents can be edited" } }), "Only draft documents can be edited");
  assert.equal(internals.upstreamErrorMessage({ message: "legacy" }), "legacy");
  assert.equal(internals.upstreamErrorMessage({ error: { message: "x".repeat(301) } }), null);
  assert.equal(internals.upstreamErrorMessage(null), null);
});

test("account profile is a named business route; password and deletion are dedicated handlers", () => {
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/account/profile"), "PATCH").path, "/auth/profile");
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/account/password"), "POST"), null);
  assert.equal(internals.matchProtectedRoute(new URL("https://a/v1/business/account/delete"), "POST"), null);
  assert.equal(internals.ACCOUNT_ACTIONS["/v1/business/account/delete"].upstream, "/auth/delete-account");
  assert.equal(internals.ACCOUNT_ACTIONS["/v1/client/account/close"].realm, "client");
  assert.equal(internals.ACCOUNT_ACTIONS["/v1/business/account/__proto__"], undefined);
});

function sessionRequest(path, body, cookie) {
  return new Request(`https://auth.chakusarecovery.com${path}`, {
    method: "POST",
    headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site", "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}
const businessAccess = `__Host-chakusa_access=${internals.encodeAccessCookie("business", "access.jwt")}; __Host-chakusa_refresh=${internals.encodeRefreshCookie("business", "refresh.token")}`;

test("a wrong password is not retried and does not end the session", async () => {
  let attempts = 0;
  const net = stubNetwork({
    "POST /auth/delete-account": () => { attempts += 1; return [401, { error: { code: "AUTH_REAUTHENTICATION_REQUIRED", message: "Password confirmation failed" } }]; },
  });
  try {
    const response = await worker.fetch(sessionRequest("/v1/business/account/delete", { password: "wrong" }, businessAccess), env);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Password confirmation failed");
    assert.equal(attempts, 1);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!net.calls.some((call) => call.key === "POST /auth/refresh"));
  } finally { net.restore(); }
});

test("a successful deletion clears both session cookies", async () => {
  const net = stubNetwork({ "POST /auth/delete-account": () => [204, {}] });
  try {
    const response = await worker.fetch(sessionRequest("/v1/business/account/delete", { password: "right" }, businessAccess), env);
    assert.equal(response.status, 200);
    const cookies = response.headers.get("set-cookie");
    assert.match(cookies, /__Host-chakusa_refresh=; .*Max-Age=0/);
    assert.match(cookies, /__Host-chakusa_access=; .*Max-Age=0/);
    assert.deepEqual(net.calls[0].body, { password: "right" });
  } finally { net.restore(); }
});

test("an expired access token is refreshed and the action retried once", async () => {
  let attempts = 0;
  const net = stubNetwork({
    "POST /auth/change-password": () => { attempts += 1; return attempts === 1 ? [401, { error: { code: "AUTH_TOKEN_INVALID", message: "expired" } }] : [204, {}]; },
    "POST /auth/refresh": () => [200, { accessToken: "new.jwt", refreshToken: "new.refresh", expiresIn: 900 }],
  });
  try {
    const response = await worker.fetch(sessionRequest("/v1/business/account/password", { currentPassword: "a", newPassword: "b".repeat(12) }, businessAccess), env);
    assert.equal(response.status, 200);
    assert.equal(attempts, 2);
    assert.ok(response.headers.get("set-cookie"));
  } finally { net.restore(); }
});

test("a client session can never run a business account action", async () => {
  const clientCookie = `__Host-chakusa_access=${internals.encodeAccessCookie("client", "access.jwt")}`;
  const net = stubNetwork({});
  try {
    const response = await worker.fetch(sessionRequest("/v1/business/account/delete", { password: "x" }, clientCookie), env);
    assert.equal(response.status, 401);
    assert.equal(net.calls.length, 0);
  } finally { net.restore(); }
});

test("team administration routes map exactly; ownership transfer is never reachable", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  const route = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method);
  assert.equal(route("/v1/business/team/summary", "GET").path, "/team/summary");
  assert.equal(route(`/v1/business/team/members/${uuid}`, "PATCH").path, `/team/members/${uuid}`);
  assert.equal(route(`/v1/business/team/members/${uuid}`, "DELETE").path, `/team/members/${uuid}`);
  assert.equal(route(`/v1/business/team/members/${uuid}/reactivate`, "POST").path, `/team/members/${uuid}/reactivate`);
  assert.equal(route("/v1/business/team/invitations", "GET").path, "/team/invitations");
  assert.equal(route("/v1/business/team/invitations", "POST").path, "/team/invitations");
  assert.equal(route(`/v1/business/team/invitations/${uuid}`, "DELETE").path, `/team/invitations/${uuid}`);
  assert.equal(route("/v1/business/team/ownership-transfer", "POST"), null);
  assert.equal(route("/v1/business/team/members", "DELETE"), null);
  assert.equal(route(`/v1/client/team/members/${uuid}`, "DELETE"), null);
});

test("customer profile routes are UUID-only", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  const route = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method);
  assert.equal(route(`/v1/business/customers/${uuid}`, "GET").path, `/customers/${uuid}`);
  assert.equal(route(`/v1/business/customers/${uuid}`, "PATCH").path, `/customers/${uuid}`);
  assert.equal(route("/v1/business/customers/audiences", "GET"), null);
  assert.equal(route("/v1/business/customers/bulk-import", "POST"), null);
});

test("client invoice detail and pay are client-realm and UUID-only", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  const route = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method);
  assert.equal(route(`/v1/client/invoices/${uuid}`, "GET").realm, "client");
  assert.equal(route(`/v1/client/invoices/${uuid}`, "GET").path, `/customer/invoices/${uuid}`);
  assert.equal(route(`/v1/client/invoices/${uuid}/pay`, "POST").path, `/customer/invoices/${uuid}/pay`);
  assert.equal(route(`/v1/client/invoices/${uuid}/pay`, "GET"), null);
  assert.equal(route("/v1/client/invoices/abc/pay", "POST"), null);
});

test("customer CSV import routes allow a larger body only on those two routes", async () => {
  const route = (url, method) => internals.matchProtectedRoute(new URL(`https://a${url}`), method);
  assert.equal(route("/v1/business/customers/import/preview", "POST").path, "/customers/bulk-import/preview");
  assert.equal(route("/v1/business/customers/import", "POST").path, "/customers/bulk-import");
  assert.equal(route("/v1/business/customers/import", "POST").maxBytes, 262_144);
  assert.equal(route("/v1/business/customers", "POST").maxBytes, undefined);
  // A 100 KB body is refused on an ordinary route before any upstream call.
  const cookie = `__Host-chakusa_access=${internals.encodeAccessCookie("business", "access.jwt")}`;
  const net = stubNetwork({ "POST /customers": () => [201, {}] , "POST /customers/bulk-import/preview": () => [200, { valid: true, rows: [] }] });
  try {
    const big = JSON.stringify({ name: "x", notes: "n".repeat(100_000) });
    const refused = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/business/customers", { method: "POST", headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site", "content-type": "application/json", cookie }, body: big }), env);
    assert.equal(refused.status, 413);
    assert.equal(net.calls.length, 0);
    const accepted = await worker.fetch(new Request("https://auth.chakusarecovery.com/v1/business/customers/import/preview", { method: "POST", headers: { origin: "https://chakusarecovery.com", "sec-fetch-site": "same-site", "content-type": "application/json", cookie }, body: JSON.stringify({ csv: "name\n" + "a\n".repeat(50_000) }) }), env);
    assert.equal(accepted.status, 200);
  } finally { net.restore(); }
});
