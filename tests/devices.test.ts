import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { sendPushToUser } from "../src/lib/push/pushService.js";
import type { PushProvider, PushSendResult } from "../src/lib/push/pushProvider.js";

describe("device registration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("registers a device token for the authenticated user", async () => {
    const { token, userId } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]", platform: "ios" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ platform: "ios", provider: "expo", isActive: true });
    // The raw token must never be echoed back in the response.
    expect(body.token).toBeUndefined();

    const stored = await prisma.deviceToken.findFirst({ where: { userId } });
    expect(stored?.token).toBe("ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]");
    expect(stored?.isActive).toBe(true);
  });

  it("does not create a duplicate row when the same token is registered twice", async () => {
    const { token, userId } = await registerAccount(app);
    const deviceToken = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });

    expect(second.statusCode).toBe(201);
    expect(await prisma.deviceToken.count({ where: { userId } })).toBe(1);
  });

  it("reactivates a previously deactivated token when it is registered again", async () => {
    const { token, userId } = await registerAccount(app);
    const deviceToken = "ExponentPushToken[cccccccccccccccccccccc]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "android" },
    });
    await app.inject({
      method: "DELETE",
      url: `/devices/${encodeURIComponent(deviceToken)}`,
      headers: authHeader(token),
    });

    const deactivated = await prisma.deviceToken.findFirst({ where: { userId } });
    expect(deactivated?.isActive).toBe(false);
    expect(deactivated?.revokedAt).not.toBeNull();

    const reregistered = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "android" },
    });
    expect(reregistered.statusCode).toBe(201);
    expect(reregistered.json().isActive).toBe(true);

    const reactivated = await prisma.deviceToken.findFirst({ where: { userId } });
    expect(reactivated?.isActive).toBe(true);
    expect(reactivated?.revokedAt).toBeNull();
    expect(reactivated?.revokedReason).toBeNull();
    expect(await prisma.deviceToken.count({ where: { userId } })).toBe(1);
  });

  it("supports multiple devices for one user", async () => {
    const { token, userId } = await registerAccount(app);

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[device-one-aaaaaaaaaaaa]", platform: "ios" },
    });
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[device-two-bbbbbbbbbbbb]", platform: "android" },
    });

    const devices = await prisma.deviceToken.findMany({ where: { userId } });
    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d.platform).sort()).toEqual(["android", "ios"]);
  });

  it("rejects registration without authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/devices",
      payload: { token: "ExponentPushToken[unauth]", platform: "ios" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid registration payload", async () => {
    const { token } = await registerAccount(app);

    const missingToken = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { platform: "ios" },
    });
    expect(missingToken.statusCode).toBe(400);

    const badPlatform = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[x]", platform: "windows-phone" },
    });
    expect(badPlatform.statusCode).toBe(400);
  });

  it("never accepts a client-supplied userId — the device is always owned by the authenticated user", async () => {
    const { token, userId } = await registerAccount(app);
    const other = await registerAccount(app, { email: "device-owner-spoof@example.com" });

    const response = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      // Deliberately sending an extra userId field — the schema doesn't
      // define it, so Zod strips it, and the route must never read userId
      // from the body regardless.
      payload: { token: "ExponentPushToken[spoof-attempt]", platform: "ios", userId: other.userId },
    });

    expect(response.statusCode).toBe(201);
    const stored = await prisma.deviceToken.findFirst({ where: { token: "ExponentPushToken[spoof-attempt]" } });
    expect(stored?.userId).toBe(userId);
    expect(stored?.userId).not.toBe(other.userId);
  });
});

describe("device ownership transfer", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("transfers ownership when a second user registers the same physical token", async () => {
    const userA = await registerAccount(app, { email: "transfer-a@example.com" });
    const userB = await registerAccount(app, { email: "transfer-b@example.com" });
    const sharedToken = "ExponentPushToken[shared-physical-device-aaaa]";

    // User A registers the token first (e.g. logs out while offline, so the
    // token is never explicitly removed).
    const registeredByA = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(userA.token),
      payload: { token: sharedToken, platform: "ios" },
    });
    expect(registeredByA.statusCode).toBe(201);
    expect(registeredByA.json().isActive).toBe(true);

    // User B later signs in on the same physical device and registers the
    // same token.
    const registeredByB = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(userB.token),
      payload: { token: sharedToken, platform: "ios" },
    });
    expect(registeredByB.statusCode).toBe(201);
    expect(registeredByB.json().isActive).toBe(true);

    // Token is no longer active for User A.
    const rowA = await prisma.deviceToken.findUnique({
      where: { userId_token: { userId: userA.userId, token: sharedToken } },
    });
    expect(rowA?.isActive).toBe(false);
    expect(rowA?.revokedReason).toBe("reassigned_to_another_user");
    expect(rowA?.revokedAt).not.toBeNull();

    // Token is active for User B.
    const rowB = await prisma.deviceToken.findUnique({
      where: { userId_token: { userId: userB.userId, token: sharedToken } },
    });
    expect(rowB?.isActive).toBe(true);

    // At most one active row for this token, database-wide.
    const activeRows = await prisma.deviceToken.findMany({ where: { token: sharedToken, isActive: true } });
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.userId).toBe(userB.userId);
  });

  it("does not create duplicates when User B re-registers the same token again", async () => {
    const userA = await registerAccount(app, { email: "transfer-dup-a@example.com" });
    const userB = await registerAccount(app, { email: "transfer-dup-b@example.com" });
    const sharedToken = "ExponentPushToken[shared-physical-device-bbbb]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(userA.token),
      payload: { token: sharedToken, platform: "ios" },
    });
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(userB.token),
      payload: { token: sharedToken, platform: "ios" },
    });
    const secondRegistration = await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(userB.token),
      payload: { token: sharedToken, platform: "ios" },
    });

    expect(secondRegistration.statusCode).toBe(201);
    expect(await prisma.deviceToken.count({ where: { token: sharedToken } })).toBe(2); // A's (inactive) + B's (active)
    expect(await prisma.deviceToken.count({ where: { token: sharedToken, userId: userB.userId } })).toBe(1);
    const activeRows = await prisma.deviceToken.findMany({ where: { token: sharedToken, isActive: true } });
    expect(activeRows).toHaveLength(1);
  });

  it("allows two different tokens to belong to the same user without interference", async () => {
    const { token, userId } = await registerAccount(app, { email: "transfer-multi@example.com" });

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[multi-device-one-aaaa]", platform: "ios" },
    });
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[multi-device-two-bbbb]", platform: "android" },
    });

    const activeRows = await prisma.deviceToken.findMany({ where: { userId, isActive: true } });
    expect(activeRows).toHaveLength(2);
  });

  it("leaves exactly one active owner when two users race to register the same token concurrently", async () => {
    // Real concurrency, not a timing trick: two HTTP requests for the same
    // physical token, from two different users, fired via Promise.all.
    // Correctness comes from the database-level partial unique index on
    // device_tokens(token) WHERE is_active (migration
    // 20260812170146_device_token_active_uniqueness) plus Serializable
    // isolation + retry in registerDevice — Postgres guarantees at most one
    // of the two transactions can leave an active row for this token,
    // regardless of how they interleave, so this assertion is
    // deterministic, not flaky.
    const userA = await registerAccount(app, { email: "transfer-race-a@example.com" });
    const userB = await registerAccount(app, { email: "transfer-race-b@example.com" });
    const sharedToken = "ExponentPushToken[shared-physical-device-race]";

    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/devices",
        headers: authHeader(userA.token),
        payload: { token: sharedToken, platform: "ios" },
      }),
      app.inject({
        method: "POST",
        url: "/devices",
        headers: authHeader(userB.token),
        payload: { token: sharedToken, platform: "android" },
      }),
    ]);

    // Both requests succeed from the caller's point of view — the loser
    // simply ends up with its row deactivated moments later, not an error.
    expect(responseA.statusCode).toBe(201);
    expect(responseB.statusCode).toBe(201);

    const activeRows = await prisma.deviceToken.findMany({ where: { token: sharedToken, isActive: true } });
    expect(activeRows).toHaveLength(1);
    expect([userA.userId, userB.userId]).toContain(activeRows[0]?.userId);

    // Exactly one row total per user max (no duplicate rows created by a
    // retry), and the total row count for this token is exactly 2 (one per
    // user who ever attempted to claim it).
    expect(await prisma.deviceToken.count({ where: { token: sharedToken } })).toBe(2);
  });
});

describe("device removal", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("deactivates the caller's own device token", async () => {
    const { token, userId } = await registerAccount(app);
    const deviceToken = "ExponentPushToken[remove-me-aaaaaaaaaaaa]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/devices/${encodeURIComponent(deviceToken)}`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(204);
    const stored = await prisma.deviceToken.findFirst({ where: { userId } });
    expect(stored?.isActive).toBe(false);
    expect(stored?.revokedReason).toBe("user_removed");
  });

  it("returns 404 when removing a token that does not exist for the caller", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/devices/ExponentPushToken%5Bnever-registered%5D",
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects removal without authentication", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/devices/ExponentPushToken%5Bx%5D",
    });
    expect(response.statusCode).toBe(401);
  });

  it("prevents a user from deactivating another user's device token (cross-user deletion)", async () => {
    const owner = await registerAccount(app, { email: "device-victim@example.com" });
    const attacker = await registerAccount(app, { email: "device-attacker@example.com" });
    const deviceToken = "ExponentPushToken[victim-device-aaaaaaaaaa]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(owner.token),
      payload: { token: deviceToken, platform: "ios" },
    });

    const crossDelete = await app.inject({
      method: "DELETE",
      url: `/devices/${encodeURIComponent(deviceToken)}`,
      headers: authHeader(attacker.token),
    });

    expect(crossDelete.statusCode).toBe(404);

    const stillActive = await prisma.deviceToken.findFirst({ where: { userId: owner.userId } });
    expect(stillActive?.isActive).toBe(true);
    expect(stillActive?.revokedAt).toBeNull();
  });

  it("cascades device token deletion when the owning account is permanently deleted", async () => {
    const account = await registerAccount(app, { email: "device-delete-cascade@example.com", password: "delete-password" });
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(account.token),
      payload: { token: "ExponentPushToken[cascade-aaaaaaaaaaaaaaaa]", platform: "ios" },
    });
    expect(await prisma.deviceToken.count({ where: { userId: account.userId } })).toBe(1);

    const deleted = await app.inject({
      method: "POST",
      url: "/auth/delete-account",
      headers: authHeader(account.token),
      payload: { password: "delete-password" },
    });
    expect(deleted.statusCode).toBe(204);

    expect(await prisma.deviceToken.count({ where: { userId: account.userId } })).toBe(0);
  });
});

describe("push service", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("does nothing and returns an empty result when the user has no active device tokens", async () => {
    const { userId } = await registerAccount(app);

    const fakeProvider: PushProvider = {
      isValidToken: () => true,
      sendToDevice: async () => { throw new Error("should not be called"); },
      sendToDevices: async () => { throw new Error("should not be called"); },
    };

    const results = await sendPushToUser(userId, { body: "hello" }, fakeProvider);
    expect(results).toEqual([]);
  });

  it("deactivates a device token when the provider reports it as invalid", async () => {
    const { token, userId } = await registerAccount(app);
    const deviceToken = "ExponentPushToken[invalid-on-send-aaaaaaaa]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });

    const fakeProvider: PushProvider = {
      isValidToken: () => true,
      sendToDevice: async (t) => ({ token: t, accepted: false, invalidToken: true, error: "DeviceNotRegistered" }),
      sendToDevices: async (tokens): Promise<PushSendResult[]> =>
        tokens.map((t) => ({ token: t, accepted: false, invalidToken: true, error: "DeviceNotRegistered" })),
    };

    const results = await sendPushToUser(userId, { body: "hello" }, fakeProvider);
    expect(results).toEqual([{ token: deviceToken, accepted: false, invalidToken: true, error: "DeviceNotRegistered" }]);

    const stored = await prisma.deviceToken.findFirst({ where: { userId } });
    expect(stored?.isActive).toBe(false);
    expect(stored?.revokedReason).toBe("provider_reported_invalid");
  });

  it("leaves a device token active when the provider accepts the message", async () => {
    const { token, userId } = await registerAccount(app);
    const deviceToken = "ExponentPushToken[accepted-aaaaaaaaaaaaaaa]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });

    const fakeProvider: PushProvider = {
      isValidToken: () => true,
      sendToDevice: async (t) => ({ token: t, accepted: true, invalidToken: false }),
      sendToDevices: async (tokens): Promise<PushSendResult[]> =>
        tokens.map((t) => ({ token: t, accepted: true, invalidToken: false })),
    };

    const results = await sendPushToUser(userId, { body: "hello" }, fakeProvider);
    expect(results).toEqual([{ token: deviceToken, accepted: true, invalidToken: false }]);

    const stored = await prisma.deviceToken.findFirst({ where: { userId } });
    expect(stored?.isActive).toBe(true);
  });

  it("does not send to a deactivated token", async () => {
    const { token, userId } = await registerAccount(app);
    const deviceToken = "ExponentPushToken[deactivated-aaaaaaaaaaa]";

    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: deviceToken, platform: "ios" },
    });
    await app.inject({
      method: "DELETE",
      url: `/devices/${encodeURIComponent(deviceToken)}`,
      headers: authHeader(token),
    });

    let called = false;
    const fakeProvider: PushProvider = {
      isValidToken: () => true,
      sendToDevice: async (t) => { called = true; return { token: t, accepted: true, invalidToken: false }; },
      sendToDevices: async (tokens) => { called = true; return tokens.map((t) => ({ token: t, accepted: true, invalidToken: false })); },
    };

    const results = await sendPushToUser(userId, { body: "hello" }, fakeProvider);
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });
});
