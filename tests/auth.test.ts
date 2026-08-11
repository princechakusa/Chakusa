import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

describe("auth", () => {
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

  it("registers a user, business, and membership together", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "owner@example.com",
        password: "password123",
        fullName: "Owner Person",
        businessName: "Owner's Barbershop",
        industry: "barber",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.user.email).toBe("owner@example.com");
    expect(body.business.name).toBe("Owner's Barbershop");

    const membership = await prisma.businessMember.findFirst({
      where: { userId: body.user.id, businessId: body.business.id },
    });
    expect(membership?.role).toBe("OWNER");
  });

  it("rejects registration with a duplicate email", async () => {
    await registerAccount(app, { email: "dupe@example.com" });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "dupe@example.com",
        password: "password123",
        fullName: "Someone Else",
        businessName: "Another Business",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  });

  it("rejects registration with an invalid payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("logs in with correct credentials and rejects incorrect ones", async () => {
    await registerAccount(app, { email: "login@example.com", password: "correct-password" });

    const good = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "login@example.com", password: "correct-password" },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().token).toBeTypeOf("string");

    const bad = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "login@example.com", password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("returns the authenticated user context from /auth/me", async () => {
    const { token, businessId } = await registerAccount(app, { email: "me@example.com" });

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.email).toBe("me@example.com");
    expect(body.business.id).toBe(businessId);
    expect(body.role).toBe("OWNER");
  });

  it("rejects requests without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("rejects requests with a malformed token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(response.statusCode).toBe(401);
  });
});
