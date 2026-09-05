const ALLOWED_ORIGINS = new Set([
  "https://chakusarecovery.com",
  "https://www.chakusarecovery.com",
]);
const ALLOWED_HOSTNAMES = new Set(["chakusarecovery.com", "www.chakusarecovery.com"]);
const COOKIE_NAME = "__Host-chakusa_refresh";
const MAX_BODY_BYTES = 16_384;

const securityHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "cross-origin-resource-policy": "same-site",
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

function json(body, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...securityHeaders,
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function readCookie(header, name) {
  for (const item of (header || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return null;
}

function encodeSessionCookie(realm, refreshToken, remember = false) {
  return `${realm === "business" ? "b" : "c"}${remember ? "1" : "0"}:${refreshToken}`;
}

function decodeSessionCookie(value) {
  if (!value || value.length > 4096) return null;
  const separator = value.indexOf(":");
  if (separator !== 2) return null;
  const prefix = value.slice(0, separator);
  const refreshToken = value.slice(separator + 1);
  if (!refreshToken || !["b0", "b1", "c0", "c1"].includes(prefix)) return null;
  return { realm: prefix[0] === "b" ? "business" : "client", refreshToken, remember: prefix[1] === "1" };
}

function sessionCookie(value, remember) {
  const persistence = remember ? "; Max-Age=2592000" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict${persistence}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function upstreamPath(realm, action) {
  const base = realm === "business" ? "/auth" : "/customer/auth";
  return `${base}/${action}`;
}

function safeUpstreamPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const { refreshToken: _refreshToken, token: _token, ...safe } = payload;
  return safe;
}

async function verifyTurnstile(token, request, env) {
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.action === "chakusa_login" && ALLOWED_HOSTNAMES.has(result.hostname);
}

async function parseBody(request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_BODY_BYTES) throw new Error("body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("body_too_large");
  return JSON.parse(text);
}

async function callApi(env, path, body) {
  const response = await fetch(`${env.API_BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  return { response, payload };
}

async function login(request, env, origin) {
  let input;
  try { input = await parseBody(request); }
  catch { return json({ error: "Invalid request." }, 400, origin); }

  const realm = input?.realm;
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  const turnstileToken = typeof input?.turnstileToken === "string" ? input.turnstileToken : "";
  if (!['client', 'business'].includes(realm) || !email || email.length > 254 || password.length < 8 || password.length > 256 || !turnstileToken) {
    return json({ error: "Check your sign-in details and try again." }, 400, origin);
  }

  let human = false;
  try { human = await verifyTurnstile(turnstileToken, request, env); } catch { human = false; }
  if (!human) return json({ error: "Security check failed. Please try again." }, 403, origin);

  try {
    const { response, payload } = await callApi(env, upstreamPath(realm, "login"), { email, password });
    if (!response.ok || typeof payload.refreshToken !== "string") {
      return json({ error: response.status === 429 ? "Too many attempts. Please wait and try again." : "Email or password is incorrect." }, response.status === 429 ? 429 : 401, origin);
    }
    return json({ ...safeUpstreamPayload(payload), realm }, 200, origin, {
      "set-cookie": sessionCookie(encodeSessionCookie(realm, payload.refreshToken, input.remember === true), input.remember === true),
    });
  } catch {
    return json({ error: "Sign-in is temporarily unavailable. Please try again." }, 503, origin);
  }
}

async function refresh(request, env, origin) {
  const session = decodeSessionCookie(readCookie(request.headers.get("cookie"), COOKIE_NAME));
  if (!session) return json({ error: "No active session." }, 401, origin, { "set-cookie": clearSessionCookie() });
  try {
    const { response, payload } = await callApi(env, upstreamPath(session.realm, "refresh"), { refreshToken: session.refreshToken });
    if (!response.ok || typeof payload.refreshToken !== "string") {
      return json({ error: "Your session has expired." }, 401, origin, { "set-cookie": clearSessionCookie() });
    }
    return json({ ...safeUpstreamPayload(payload), realm: session.realm }, 200, origin, {
      "set-cookie": sessionCookie(encodeSessionCookie(session.realm, payload.refreshToken, session.remember), session.remember),
    });
  } catch {
    return json({ error: "Session refresh is temporarily unavailable." }, 503, origin);
  }
}

async function logout(request, env, origin) {
  const session = decodeSessionCookie(readCookie(request.headers.get("cookie"), COOKIE_NAME));
  if (session) {
    try { await callApi(env, upstreamPath(session.realm, "logout"), { refreshToken: session.refreshToken }); } catch { /* Clear locally even if upstream is unavailable. */ }
  }
  return json({ ok: true }, 200, origin, { "set-cookie": clearSessionCookie() });
}

export const internals = { decodeSessionCookie, encodeSessionCookie, readCookie, safeUpstreamPayload, upstreamPath };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true }, 200, "");
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, "");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...securityHeaders, ...corsHeaders(origin), "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin, { allow: "POST, OPTIONS" });
    if (url.pathname === "/v1/login") return login(request, env, origin);
    if (url.pathname === "/v1/refresh") return refresh(request, env, origin);
    if (url.pathname === "/v1/logout") return logout(request, env, origin);
    return json({ error: "Not found." }, 404, origin);
  },
};
