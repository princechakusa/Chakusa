const ALLOWED_ORIGINS = new Set(["https://chakusarecovery.com", "https://www.chakusarecovery.com"]);
const ALLOWED_HOSTNAMES = new Set(["chakusarecovery.com", "www.chakusarecovery.com"]);
const REFRESH_COOKIE = "__Host-chakusa_refresh";
const ACCESS_COOKIE = "__Host-chakusa_access";
const MAX_BODY_BYTES = 32_768;
const LEGAL_TYPES = ["TERMS_OF_SERVICE", "PRIVACY_POLICY", "AI_DISCLOSURE"];

const securityHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function corsHeaders(origin) {
  return ALLOWED_ORIGINS.has(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" }
    : {};
}

function json(body, status, origin, options = {}) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...securityHeaders, ...corsHeaders(origin), ...(options.headers || {}) });
  for (const cookie of options.cookies || []) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function readCookie(header, name) {
  for (const item of (header || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator >= 0 && item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return null;
}

function realmPrefix(realm) { return realm === "business" ? "b" : "c"; }
function encodeRefreshCookie(realm, refreshToken, remember = false) { return `${realmPrefix(realm)}${remember ? "1" : "0"}:${refreshToken}`; }
function encodeAccessCookie(realm, accessToken) { return `${realmPrefix(realm)}:${accessToken}`; }

function decodeRefreshCookie(value) {
  if (!value || value.length > 4096 || value.indexOf(":") !== 2) return null;
  const prefix = value.slice(0, 2); const refreshToken = value.slice(3);
  if (!refreshToken || !["b0", "b1", "c0", "c1"].includes(prefix)) return null;
  return { realm: prefix[0] === "b" ? "business" : "client", refreshToken, remember: prefix[1] === "1" };
}

function decodeAccessCookie(value) {
  if (!value || value.length > 4096 || value.indexOf(":") !== 1) return null;
  const prefix = value[0]; const accessToken = value.slice(2);
  if (!accessToken || (prefix !== "b" && prefix !== "c")) return null;
  return { realm: prefix === "b" ? "business" : "client", accessToken };
}

function cookie(name, value, maxAge) {
  const persistence = Number.isFinite(maxAge) ? `; Max-Age=${Math.max(0, Math.floor(maxAge))}` : "";
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict${persistence}`;
}

function sessionCookies(realm, payload, remember) {
  return [
    cookie(REFRESH_COOKIE, encodeRefreshCookie(realm, payload.refreshToken, remember), remember ? 2_592_000 : undefined),
    cookie(ACCESS_COOKIE, encodeAccessCookie(realm, payload.accessToken), Math.min(Number(payload.expiresIn) || 900, 900)),
  ];
}

function clearSessionCookies() { return [cookie(REFRESH_COOKIE, "", 0), cookie(ACCESS_COOKIE, "", 0)]; }
function authBase(realm) { return realm === "business" ? "/auth" : "/customer/auth"; }
function authPath(realm, action) { return `${authBase(realm)}/${action}`; }
function legalBase(realm) { return realm === "business" ? "/business/legal" : "/customer/legal"; }

function safeAuthPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const { refreshToken: _refreshToken, accessToken: _accessToken, token: _token, expiresIn: _expiresIn, tokenType: _tokenType, ...safe } = payload;
  return safe;
}

async function verifyTurnstile(token, expectedAction, request, env) {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get("cf-connecting-ip") || "" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.action === expectedAction && ALLOWED_HOSTNAMES.has(result.hostname);
}

async function parseBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new Error("invalid_content_type");
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("body_too_large");
  return JSON.parse(text);
}

async function callApi(env, path, { method = "GET", body, accessToken } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${env.API_BASE_URL.replace(/\/$/, "")}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  let payload = {};
  if (response.status !== 204) { try { payload = await response.json(); } catch { payload = {}; } }
  return { response, payload };
}

function validEmail(value) { return typeof value === "string" && value.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function validPassword(value, registration = false) { return typeof value === "string" && value.length <= 256 && value.length >= (registration ? 12 : 1); }

async function authenticate(request, env, origin, action) {
  let input;
  try { input = await parseBody(request); } catch { return json({ error: "Invalid request." }, 400, origin); }
  const realm = input?.realm;
  const registration = action === "register";
  if (!["client", "business"].includes(realm) || !validEmail(input?.email) || !validPassword(input?.password, registration) || typeof input?.turnstileToken !== "string") {
    return json({ error: registration ? "Check the account details and try again." : "Check your sign-in details and try again." }, 400, origin);
  }
  if (registration) {
    if (input.acceptedLegal !== true || typeof input.fullName !== "string" || input.fullName.trim().length < 1 || input.fullName.trim().length > 120) return json({ error: "Complete every required field and accept the legal documents." }, 400, origin);
    if (realm === "business" && (typeof input.businessName !== "string" || input.businessName.trim().length < 1 || input.businessName.trim().length > 200)) return json({ error: "Enter your business name." }, 400, origin);
  }
  let human = false;
  try { human = await verifyTurnstile(input.turnstileToken, registration ? "chakusa_register" : "chakusa_login", request, env); } catch { human = false; }
  if (!human) return json({ error: "Security check failed. Please try again." }, 403, origin);

  const body = registration
    ? realm === "business"
      ? { email: input.email.trim().toLowerCase(), password: input.password, fullName: input.fullName.trim(), businessName: input.businessName.trim(), industry: typeof input.industry === "string" ? input.industry.trim() : undefined }
      : { email: input.email.trim().toLowerCase(), password: input.password, fullName: input.fullName.trim(), displayName: typeof input.displayName === "string" ? input.displayName.trim() || undefined : undefined, phone: typeof input.phone === "string" ? input.phone.trim() || undefined : undefined }
    : { email: input.email.trim().toLowerCase(), password: input.password };
  try {
    const { response, payload } = await callApi(env, authPath(realm, action), { method: "POST", body });
    if (!response.ok || typeof payload.refreshToken !== "string" || typeof payload.accessToken !== "string") {
      const throttled = response.status === 429;
      return json({ error: throttled ? "Too many attempts. Please wait and try again." : registration ? "We could not create that account. Try signing in if you already registered." : "Email or password is incorrect." }, throttled ? 429 : registration ? 400 : 401, origin);
    }
    if (registration) {
      await Promise.all(LEGAL_TYPES.map((type) => callApi(env, `${legalBase(realm)}/accept`, { method: "POST", body: { type, source: "website_registration", platform: "web" }, accessToken: payload.accessToken })));
    }
    return json({ ...safeAuthPayload(payload), realm, next: registration && realm === "business" ? "/dashboard/business/setup" : `/dashboard/${realm}` }, response.status, origin, { cookies: sessionCookies(realm, payload, input.remember === true) });
  } catch {
    return json({ error: registration ? "Account creation is temporarily unavailable." : "Sign-in is temporarily unavailable." }, 503, origin);
  }
}

async function googleAuthenticate(request, env, origin) {
  let input;
  try { input = await parseBody(request); } catch { return json({ error: "Invalid request." }, 400, origin); }
  const realm = input?.realm;
  if (!["client", "business"].includes(realm) || typeof input?.idToken !== "string" || input.idToken.length < 20 || input.idToken.length > 16_384 || typeof input?.turnstileToken !== "string") {
    return json({ error: "Google sign-in could not be verified." }, 400, origin);
  }
  let human = false;
  const googleAction = input.flow === "register" ? "chakusa_register" : "chakusa_login";
  try { human = await verifyTurnstile(input.turnstileToken, googleAction, request, env); } catch { human = false; }
  if (!human) return json({ error: "Security check failed. Please try again." }, 403, origin);
  try {
    const { response, payload } = await callApi(env, authPath(realm, "google"), { method: "POST", body: { idToken: input.idToken } });
    if (!response.ok || typeof payload.refreshToken !== "string" || typeof payload.accessToken !== "string") {
      const message = response.status === 409 ? "An account with this email already exists. Sign in with your password, then connect Google from account settings." : "Google sign-in was not completed.";
      return json({ error: message }, response.status === 429 ? 429 : response.status === 409 ? 409 : 401, origin);
    }
    let business = payload.business;
    if (realm === "business" && !business) {
      const name = typeof input.businessName === "string" ? input.businessName.trim() : "";
      if (!name) return json({ error: "Enter your business name before creating a business account with Google." }, 409, origin);
      const created = await callApi(env, "/business", { method: "POST", body: { name, industry: typeof input.industry === "string" ? input.industry.trim() || undefined : undefined }, accessToken: payload.accessToken });
      if (!created.response.ok) return json({ error: "Your Google account is secure, but the business workspace could not be created." }, 400, origin);
      business = created.payload;
    }
    if (input.acceptedLegal === true) {
      await Promise.all(LEGAL_TYPES.map((type) => callApi(env, `${legalBase(realm)}/accept`, { method: "POST", body: { type, source: "website_google_auth", platform: "web" }, accessToken: payload.accessToken })));
    }
    const next = realm === "business" && (payload.isNewUser || !payload.business) ? "/dashboard/business/setup" : `/dashboard/${realm}`;
    return json({ ...safeAuthPayload(payload), business, realm, next }, 200, origin, { cookies: sessionCookies(realm, payload, input.remember === true) });
  } catch {
    return json({ error: "Google sign-in is temporarily unavailable." }, 503, origin);
  }
}

async function passwordRecovery(request, env, origin, action) {
  let input;
  try { input = await parseBody(request); } catch { return json({ error: "Invalid request." }, 400, origin); }
  if (!["client", "business"].includes(input?.realm) || typeof input?.turnstileToken !== "string") return json({ error: "Check the details and try again." }, 400, origin);
  if (action === "forgot-password" && !validEmail(input.email)) return json({ error: "Enter a valid email address." }, 400, origin);
  if (action === "reset-password" && (typeof input.token !== "string" || input.token.length < 20 || !validPassword(input.password, true))) return json({ error: "Use a valid reset link and a password of at least 12 characters." }, 400, origin);
  let human = false;
  try { human = await verifyTurnstile(input.turnstileToken, action === "forgot-password" ? "chakusa_forgot" : "chakusa_reset", request, env); } catch { human = false; }
  if (!human) return json({ error: "Security check failed. Please try again." }, 403, origin);
  const body = action === "forgot-password" ? { email: input.email.trim().toLowerCase() } : { token: input.token, password: input.password };
  try {
    const { response, payload } = await callApi(env, authPath(input.realm, action), { method: "POST", body });
    if (!response.ok) return json({ error: action === "forgot-password" ? "The request could not be completed." : "This reset link is invalid or has expired." }, response.status === 429 ? 429 : 400, origin);
    return json({ message: typeof payload.message === "string" ? payload.message : action === "forgot-password" ? "If an account exists, reset instructions have been sent." : "Password reset successfully." }, 200, origin);
  } catch {
    return json({ error: "Account recovery is temporarily unavailable." }, 503, origin);
  }
}

async function refreshSession(request, env) {
  const session = decodeRefreshCookie(readCookie(request.headers.get("cookie"), REFRESH_COOKIE));
  if (!session) return null;
  const { response, payload } = await callApi(env, authPath(session.realm, "refresh"), { method: "POST", body: { refreshToken: session.refreshToken } });
  if (!response.ok || typeof payload.refreshToken !== "string" || typeof payload.accessToken !== "string") return null;
  return { realm: session.realm, accessToken: payload.accessToken, cookies: sessionCookies(session.realm, payload, session.remember) };
}

async function authorizedSession(request, env) {
  const access = decodeAccessCookie(readCookie(request.headers.get("cookie"), ACCESS_COOKIE));
  if (access) return { ...access, cookies: [] };
  return refreshSession(request, env);
}

async function dashboardBundle(request, env, origin) {
  let session;
  try { session = await authorizedSession(request, env); } catch { session = null; }
  if (!session) return json({ error: "Your session has expired." }, 401, origin, { cookies: clearSessionCookies() });
  const load = (token) => session.realm === "business"
    ? Promise.all([
        callApi(env, "/auth/me", { accessToken: token }), callApi(env, "/business", { accessToken: token }),
        callApi(env, "/dashboard/summary", { accessToken: token }), callApi(env, "/business/legal/status", { accessToken: token }),
      ])
    : Promise.all([
        callApi(env, "/customer/auth/me", { accessToken: token }), callApi(env, "/customer/dashboard", { accessToken: token }),
        callApi(env, "/customer/legal/status", { accessToken: token }),
      ]);
  let results = await load(session.accessToken);
  if (results.some((item) => item.response.status === 401)) {
    try { session = await refreshSession(request, env); } catch { session = null; }
    if (!session) return json({ error: "Your session has expired." }, 401, origin, { cookies: clearSessionCookies() });
    results = await load(session.accessToken);
  }
  if (results.some((item) => !item.response.ok)) return json({ error: "Your dashboard is temporarily unavailable." }, 503, origin, { cookies: session.cookies });
  return session.realm === "business"
    ? json({ realm: session.realm, account: results[0].payload, business: results[1].payload, dashboard: results[2].payload, legal: results[3].payload }, 200, origin, { cookies: session.cookies })
    : json({ realm: session.realm, account: results[0].payload, dashboard: results[1].payload, legal: results[2].payload }, 200, origin, { cookies: session.cookies });
}

async function protectedMutation(request, env, origin, expectedRealm, path, method) {
  let session;
  try { session = await authorizedSession(request, env); } catch { session = null; }
  if (!session || session.realm !== expectedRealm) return json({ error: "Your session has expired." }, 401, origin, { cookies: clearSessionCookies() });
  let body;
  try { body = method === "PATCH" ? await parseBody(request) : {}; } catch { return json({ error: "Invalid request." }, 400, origin); }
  let result = await callApi(env, path, { method, body, accessToken: session.accessToken });
  if (result.response.status === 401) {
    try { session = await refreshSession(request, env); } catch { session = null; }
    if (!session || session.realm !== expectedRealm) return json({ error: "Your session has expired." }, 401, origin, { cookies: clearSessionCookies() });
    result = await callApi(env, path, { method, body, accessToken: session.accessToken });
  }
  if (!result.response.ok) return json({ error: "We could not save those changes. Check the details and try again." }, result.response.status >= 500 ? 503 : 400, origin, { cookies: session.cookies });
  return json(result.payload, 200, origin, { cookies: session.cookies });
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const protectedRoutes = [
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/customers$/, upstream: "/customers", query: ["search", "page", "pageSize"] },
  { method: "POST", realm: "business", pattern: /^\/v1\/business\/customers$/, upstream: "/customers" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/leads$/, upstream: "/leads", query: ["status", "page", "pageSize"] },
  { method: "POST", realm: "business", pattern: /^\/v1\/business\/leads$/, upstream: "/leads" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/appointments$/, upstream: "/appointments", query: ["from", "to", "status", "customerId"] },
  { method: "POST", realm: "business", pattern: /^\/v1\/business\/appointments$/, upstream: "/appointments" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/reviews$/, upstream: "/review-requests" },
  { method: "POST", realm: "business", pattern: /^\/v1\/business\/reviews$/, upstream: "/review-requests" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/quotes$/, upstream: "/quotes", query: ["documentType", "status", "page", "pageSize"] },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/invoices$/, upstream: "/invoices", query: ["status", "customerId", "page", "pageSize"] },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/services$/, upstream: "/services", query: ["active"] },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/messages$/, upstream: "/messages/conversations", query: ["status", "cursor", "limit"] },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/automations$/, upstream: "/automation/workflows" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/reminders$/, upstream: "/reminders" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/reports$/, upstream: "/weekly-reports" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/attention$/, upstream: "/dashboard/attention", query: ["category", "page", "pageSize"] },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/insights$/, upstream: "/dashboard/insights" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/payments$/, upstream: "/payments/connect/status" },
  { method: "POST", realm: "business", pattern: /^\/v1\/business\/payments\/connect$/, upstream: "/payments/connect/link" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/team$/, upstream: "/team/members" },
  { method: "GET", realm: "business", pattern: /^\/v1\/business\/support$/, upstream: "/support-tickets" },
  { method: "POST", realm: "business", pattern: /^\/v1\/business\/support$/, upstream: "/support-tickets" },
  { method: "GET", realm: "client", pattern: /^\/v1\/client\/bookings$/, upstream: "/customer/bookings", query: ["scope"] },
  { method: "GET", realm: "client", pattern: /^\/v1\/client\/businesses$/, upstream: "/customer/businesses" },
  { method: "GET", realm: "client", pattern: /^\/v1\/client\/profile$/, upstream: "/customer/profile" },
  { method: "PATCH", realm: "client", pattern: /^\/v1\/client\/profile$/, upstream: "/customer/profile" },
  { method: "GET", realm: "client", pattern: /^\/v1\/client\/notifications$/, upstream: "/customer/notifications", query: ["unreadOnly", "limit"] },
  { method: "GET", realm: "client", pattern: /^\/v1\/client\/invoices$/, upstream: "/customer/invoices" },
  { method: "POST", realm: "client", pattern: new RegExp(`^/v1/client/bookings/(${UUID})/cancel$`), upstream: (match) => `/customer/bookings/${match[1]}/cancel` },
];

function matchProtectedRoute(url, method) {
  for (const route of protectedRoutes) {
    if (route.method !== method) continue;
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    const base = typeof route.upstream === "function" ? route.upstream(match) : route.upstream;
    const query = new URLSearchParams();
    for (const key of route.query || []) { const value = url.searchParams.get(key); if (value !== null && value.length <= 200) query.set(key, value); }
    return { ...route, path: `${base}${query.size ? `?${query}` : ""}` };
  }
  return null;
}

async function protectedProxy(request, env, origin, route) {
  let session;
  try { session = await authorizedSession(request, env); } catch { session = null; }
  if (!session || session.realm !== route.realm) return json({ error: "Your session has expired." }, 401, origin, { cookies: clearSessionCookies() });
  let body;
  if (["POST", "PATCH"].includes(route.method)) {
    try { body = await parseBody(request); } catch { return json({ error: "Invalid request." }, 400, origin); }
  }
  let result = await callApi(env, route.path, { method: route.method, body, accessToken: session.accessToken });
  if (result.response.status === 401) {
    try { session = await refreshSession(request, env); } catch { session = null; }
    if (!session || session.realm !== route.realm) return json({ error: "Your session has expired." }, 401, origin, { cookies: clearSessionCookies() });
    result = await callApi(env, route.path, { method: route.method, body, accessToken: session.accessToken });
  }
  if (!result.response.ok) {
    const upstreamMessage = result.payload && typeof result.payload.message === "string" ? result.payload.message : null;
    return json({ error: result.response.status >= 500 ? "This dashboard service is temporarily unavailable." : upstreamMessage || "Check the details and try again." }, result.response.status >= 500 ? 503 : result.response.status, origin, { cookies: session.cookies });
  }
  return json(result.payload, result.response.status === 201 ? 201 : 200, origin, { cookies: session.cookies });
}

async function logout(request, env, origin) {
  const session = decodeRefreshCookie(readCookie(request.headers.get("cookie"), REFRESH_COOKIE));
  if (session) { try { await callApi(env, authPath(session.realm, "logout"), { method: "POST", body: { refreshToken: session.refreshToken } }); } catch { /* Local cookie removal must still complete. */ } }
  return json({ ok: true }, 200, origin, { cookies: clearSessionCookies() });
}

export const internals = { decodeAccessCookie, decodeRefreshCookie, encodeAccessCookie, encodeRefreshCookie, readCookie, safeAuthPayload, authPath, matchProtectedRoute };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || ""; const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true }, 200, "");
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, "");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-site" && fetchSite !== "same-origin") return json({ error: "Request context not allowed." }, 403, origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...securityHeaders, ...corsHeaders(origin), "access-control-allow-methods": "GET, POST, PATCH, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } });
    if (url.pathname === "/v1/login" && request.method === "POST") return authenticate(request, env, origin, "login");
    if (url.pathname === "/v1/register" && request.method === "POST") return authenticate(request, env, origin, "register");
    if (url.pathname === "/v1/google" && request.method === "POST") return googleAuthenticate(request, env, origin);
    if (url.pathname === "/v1/forgot-password" && request.method === "POST") return passwordRecovery(request, env, origin, "forgot-password");
    if (url.pathname === "/v1/reset-password" && request.method === "POST") return passwordRecovery(request, env, origin, "reset-password");
    if (url.pathname === "/v1/dashboard" && request.method === "GET") return dashboardBundle(request, env, origin);
    if (url.pathname === "/v1/business" && request.method === "PATCH") return protectedMutation(request, env, origin, "business", "/business", "PATCH");
    if (url.pathname === "/v1/business/onboarding/complete" && request.method === "POST") return protectedMutation(request, env, origin, "business", "/business/onboarding/complete", "POST");
    if (url.pathname === "/v1/logout" && request.method === "POST") return logout(request, env, origin);
    const protectedRoute = matchProtectedRoute(url, request.method);
    if (protectedRoute) return protectedProxy(request, env, origin, protectedRoute);
    return json({ error: "Not found." }, 404, origin);
  },
};
