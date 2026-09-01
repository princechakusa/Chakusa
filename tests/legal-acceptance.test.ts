import type { AdminRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, authHeader, registerAccount, resetDatabase } from "./helpers.js";

// PROGRAM 2 LOOP 4: first test coverage for the legal-acceptance platform.
// None existed before this file, even though the routes were already
// committed and live, closing a real gap flagged in the Loop 4 report.
//
// NOTE ON A RED HERRING FOUND WHILE WRITING THIS: rows created mid-test
// (admin accounts, customer accounts, draft document versions) occasionally
// vanished moments after creation, surfacing as scattered 401s and 404s
// with no consistent pattern. Traced this down to running this file at the
// same time as an unrelated, already-in-flight `npx vitest run` of the
// *entire* backend suite in another shell against the same local
// chakusa_test database — that run's own resetDatabase() calls, in
// completely unrelated test files, were racing with and wiping this file's
// in-flight data (confirmed: that other run showed the identical
// "record required but not found" symptom in its own unrelated tests at
// the same time). Not a bug in the Legal Platform, the admin auth code, or
// this file — it disappeared entirely once run in isolation. Documented
// here so a future flaky run of this file is investigated as "is something
// else running against chakusa_test right now" before anything else.

async function registerCustomer(app: FastifyInstance, overrides: Partial<{ email: string }> = {}) {
  const email = overrides.email ?? `legal-cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Legal Test Customer" } });
  if (res.statusCode !== 201) throw new Error(`customer register failed: ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, profileId: body.profile.id as string, userId: body.user.id as string };
}

async function admin(app: FastifyInstance, role: AdminRole = "SUPER_ADMIN") {
  const email = `legal-admin-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `${role} Legal Admin` });
  await prisma.adminMembership.create({ data: { userId: account.userId, role } });
  const response = await app.inject({ method: "POST", url: "/admin/auth/login", headers: { origin: "http://localhost:5173" }, payload: { email, password: "admin-password-123" } });
  if (response.statusCode !== 200) throw new Error(`admin login failed: ${response.body}`);
  return { account, token: response.json().accessToken as string, csrf: response.json().csrfToken as string };
}

function adminHeaders(token: string, csrf?: string) {
  return { origin: "http://localhost:5173", authorization: `Bearer ${token}`, ...(csrf ? { "x-csrf-token": csrf } : {}) };
}

interface AdminSession { token: string; csrf: string }

async function publishVersion(app: FastifyInstance, session: AdminSession, type: string, overrides: Partial<{ title: string; content: string }> = {}) {
  const created = await app.inject({
    method: "POST",
    url: "/admin/legal/versions",
    headers: adminHeaders(session.token, session.csrf),
    payload: { type, title: overrides.title ?? `${type} v1`, content: overrides.content ?? "Real content for this version." },
  });
  if (created.statusCode !== 201) throw new Error(`create draft failed (${created.statusCode}): ${created.body}`);
  const version = created.json();
  const published = await app.inject({ method: "POST", url: `/admin/legal/versions/${version.id}/publish`, headers: adminHeaders(session.token, session.csrf) });
  if (published.statusCode !== 200) throw new Error(`publish failed (${published.statusCode}): ${published.body}`);
  return published.json();
}

describe("legal document platform", () => {
  let app: FastifyInstance;
  beforeAll(async () => { config.ADMIN_CONSOLE_ENABLED = true; config.ADMIN_CONSOLE_ORIGIN = "http://localhost:5173"; app = await createTestApp(); });
  beforeEach(resetDatabase);
  afterAll(async () => { config.ADMIN_CONSOLE_ENABLED = false; config.ADMIN_CONSOLE_ORIGIN = undefined; await app.close(); });

  describe("public document endpoint", () => {
    it("404s when nothing has been published for a type yet", async () => {
      const res = await app.inject({ method: "GET", url: "/legal/documents/PRIVACY_POLICY" });
      expect(res.statusCode).toBe(404);
    });

    it("serves the current published version once one exists", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "PRIVACY_POLICY", { title: "Our Privacy Policy", content: "We collect only what we need." });
      const res = await app.inject({ method: "GET", url: "/legal/documents/PRIVACY_POLICY" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.title).toBe("Our Privacy Policy");
      expect(body.content).toBe("We collect only what we need.");
      expect(body.version).toBe(1);
    });

    it("rejects an unknown document type before it ever reaches the database", async () => {
      const res = await app.inject({ method: "GET", url: "/legal/documents/NOT_A_REAL_TYPE" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("admin version lifecycle", () => {
    it("requires legal.manage to create a draft, and rejects a role that only has legal.read", async () => {
      const session = await admin(app, "SUPPORT_AGENT"); // has legal.read only, per admin.permissions.ts
      const res = await app.inject({ method: "POST", url: "/admin/legal/versions", headers: adminHeaders(session.token, session.csrf), payload: { type: "TERMS_OF_SERVICE", title: "t", content: "c" } });
      expect(res.statusCode).toBe(403);
    });

    it("publishing a new version archives whichever version was previously published, never deleting content", async () => {
      const session = await admin(app);
      const v1 = await publishVersion(app, session, "TERMS_OF_SERVICE", { content: "Version one text." });
      const v2 = await publishVersion(app, session, "TERMS_OF_SERVICE", { content: "Version two text." });
      expect(v2.version).toBe(2);

      const [reloadedV1, reloadedV2] = await Promise.all([
        prisma.legalDocumentVersion.findUniqueOrThrow({ where: { id: v1.id } }),
        prisma.legalDocumentVersion.findUniqueOrThrow({ where: { id: v2.id } }),
      ]);
      expect(reloadedV1.status).toBe("ARCHIVED");
      expect(reloadedV1.content).toBe("Version one text."); // never rewritten
      expect(reloadedV2.status).toBe("PUBLISHED");

      const current = await app.inject({ method: "GET", url: "/legal/documents/TERMS_OF_SERVICE" });
      expect(current.json().version).toBe(2);
    });

    it("can roll back to an archived version, republishing it without rewriting its content", async () => {
      const session = await admin(app);
      const v1 = await publishVersion(app, session, "COOKIE_POLICY", { content: "Original cookie text." });
      await publishVersion(app, session, "COOKIE_POLICY", { content: "Bad edit, needs reverting." });

      const rolledBack = await app.inject({ method: "POST", url: `/admin/legal/versions/${v1.id}/rollback`, headers: adminHeaders(session.token, session.csrf) });
      expect(rolledBack.statusCode).toBe(200);
      expect(rolledBack.json().status).toBe("PUBLISHED");
      expect(rolledBack.json().content).toBe("Original cookie text.");

      const current = await app.inject({ method: "GET", url: "/legal/documents/COOKIE_POLICY" });
      expect(current.json().version).toBe(1);
      expect(current.json().content).toBe("Original cookie text.");
    });

    it("refuses to archive a version that isn't currently published", async () => {
      const session = await admin(app);
      const created = await app.inject({ method: "POST", url: "/admin/legal/versions", headers: adminHeaders(session.token, session.csrf), payload: { type: "AI_DISCLOSURE", title: "t", content: "c" } });
      const draftId = created.json().id;
      const archived = await app.inject({ method: "POST", url: `/admin/legal/versions/${draftId}/archive`, headers: adminHeaders(session.token, session.csrf) });
      expect(archived.statusCode).toBe(400); // still DRAFT, not PUBLISHED
    });
  });

  describe("customer acceptance", () => {
    it("lists a document as pending until the customer accepts the currently published version", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "TERMS_OF_SERVICE");
      await publishVersion(app, session, "PRIVACY_POLICY");
      await publishVersion(app, session, "AI_DISCLOSURE");
      const customer = await registerCustomer(app);

      const before = await app.inject({ method: "GET", url: "/customer/legal/status", headers: authHeader(customer.token) });
      const pendingTypes = before.json().pending.map((p: { type: string }) => p.type).sort();
      expect(pendingTypes).toEqual(["AI_DISCLOSURE", "PRIVACY_POLICY", "TERMS_OF_SERVICE"]);

      const accept = await app.inject({ method: "POST", url: "/customer/legal/accept", headers: authHeader(customer.token), payload: { type: "TERMS_OF_SERVICE", source: "onboarding" } });
      expect(accept.statusCode).toBe(200);

      const after = await app.inject({ method: "GET", url: "/customer/legal/status", headers: authHeader(customer.token) });
      const stillPending = after.json().pending.map((p: { type: string }) => p.type).sort();
      expect(stillPending).toEqual(["AI_DISCLOSURE", "PRIVACY_POLICY"]);
    });

    it("records cookie-category choices on the acceptance event without a second consent mechanism", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "COOKIE_POLICY");
      const customer = await registerCustomer(app);
      const accept = await app.inject({
        method: "POST",
        url: "/customer/legal/accept",
        headers: authHeader(customer.token),
        payload: { type: "COOKIE_POLICY", source: "customize", cookiePreferences: { analytics: true, functional: true, marketing: false } },
      });
      expect(accept.statusCode).toBe(200);
      const stored = await prisma.legalAcceptanceEvent.findUniqueOrThrow({ where: { id: accept.json().id } });
      expect(stored.metadata).toEqual({ cookiePreferences: { analytics: true, functional: true, marketing: false } });
    });

    it("never overwrites a previous acceptance, a re-accept is a new immutable row", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "TERMS_OF_SERVICE");
      const customer = await registerCustomer(app);
      await app.inject({ method: "POST", url: "/customer/legal/accept", headers: authHeader(customer.token), payload: { type: "TERMS_OF_SERVICE" } });
      await app.inject({ method: "POST", url: "/customer/legal/accept", headers: authHeader(customer.token), payload: { type: "TERMS_OF_SERVICE" } });
      const events = await prisma.legalAcceptanceEvent.findMany({ where: { userId: customer.userId } });
      expect(events).toHaveLength(2);
    });

    it("requires re-acceptance after a new version publishes, since acceptance is tied to a specific version id", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "PRIVACY_POLICY", { content: "v1 text" });
      const customer = await registerCustomer(app);
      await app.inject({ method: "POST", url: "/customer/legal/accept", headers: authHeader(customer.token), payload: { type: "PRIVACY_POLICY" } });

      let status = await app.inject({ method: "GET", url: "/customer/legal/status", headers: authHeader(customer.token) });
      expect(status.json().pending).toEqual([]);

      await publishVersion(app, session, "PRIVACY_POLICY", { content: "v2 text, changed" });
      status = await app.inject({ method: "GET", url: "/customer/legal/status", headers: authHeader(customer.token) });
      expect(status.json().pending.map((p: { type: string }) => p.type)).toEqual(["PRIVACY_POLICY"]);
    });
  });

  describe("business acceptance", () => {
    it("requires AI_DISCLOSURE acceptance for business accounts too, not just customers", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "TERMS_OF_SERVICE");
      await publishVersion(app, session, "PRIVACY_POLICY");
      await publishVersion(app, session, "AI_DISCLOSURE");
      const account = await registerAccount(app);

      const status = await app.inject({ method: "GET", url: "/business/legal/status", headers: authHeader(account.accessToken) });
      const pendingTypes = status.json().pending.map((p: { type: string }) => p.type).sort();
      expect(pendingTypes).toEqual(["AI_DISCLOSURE", "PRIVACY_POLICY", "TERMS_OF_SERVICE"]);
    });

    it("keeps business and customer acceptance scoped separately even for the same underlying user id", async () => {
      const session = await admin(app);
      await publishVersion(app, session, "TERMS_OF_SERVICE");
      const account = await registerAccount(app);
      await app.inject({ method: "POST", url: "/business/legal/accept", headers: authHeader(account.accessToken), payload: { type: "TERMS_OF_SERVICE" } });
      const event = await prisma.legalAcceptanceEvent.findFirstOrThrow({ where: { userId: account.userId } });
      expect(event.scope).toBe("BUSINESS");
    });
  });

  describe("admin analytics", () => {
    it("counts acceptance and breaks down cookie consent choices", async () => {
      const session = await admin(app);
      const published = await publishVersion(app, session, "COOKIE_POLICY");
      const alice = await registerCustomer(app);
      const bob = await registerCustomer(app);
      await app.inject({ method: "POST", url: "/customer/legal/accept", headers: authHeader(alice.token), payload: { type: "COOKIE_POLICY", source: "accept_all", cookiePreferences: { analytics: true, functional: true, marketing: true } } });
      await app.inject({ method: "POST", url: "/customer/legal/accept", headers: authHeader(bob.token), payload: { type: "COOKIE_POLICY", source: "reject_optional", cookiePreferences: { analytics: false, functional: false, marketing: false } } });

      const stats = await app.inject({ method: "GET", url: `/admin/legal/versions/${published.id}/stats`, headers: adminHeaders(session.token, session.csrf) });
      expect(stats.json().acceptanceCount).toBe(2);

      const cookieStats = await app.inject({ method: "GET", url: `/admin/legal/versions/${published.id}/cookie-analytics`, headers: adminHeaders(session.token, session.csrf) });
      expect(cookieStats.json().total).toBe(2);
      expect(cookieStats.json().bySource).toEqual({ accept_all: 1, reject_optional: 1 });
      expect(cookieStats.json().categoryCounts).toEqual({ analytics: 1, functional: 1, marketing: 1 });
    });
  });
});
