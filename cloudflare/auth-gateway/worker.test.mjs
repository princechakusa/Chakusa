import assert from "node:assert/strict";
import test from "node:test";
import { internals } from "./worker.mjs";

test("session cookie realm and persistence round trip without changing the opaque token", () => {
  const value = internals.encodeSessionCookie("business", "family.secret.part", true);
  assert.deepEqual(internals.decodeSessionCookie(value), { realm: "business", refreshToken: "family.secret.part", remember: true });
});

test("malformed session cookies are rejected", () => {
  assert.equal(internals.decodeSessionCookie("x0:anything"), null);
  assert.equal(internals.decodeSessionCookie("b0:"), null);
  assert.equal(internals.decodeSessionCookie(null), null);
});

test("refresh tokens and legacy token aliases never reach browser payloads", () => {
  assert.deepEqual(internals.safeUpstreamPayload({ accessToken: "short", token: "short", refreshToken: "secret", user: { id: "1" } }), { accessToken: "short", user: { id: "1" } });
});

test("client and business sessions stay on separate backend routes", () => {
  assert.equal(internals.upstreamPath("client", "login"), "/customer/auth/login");
  assert.equal(internals.upstreamPath("business", "refresh"), "/auth/refresh");
});
