import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function resetDatabase() {
  await prisma.$transaction([
    prisma.activityEvent.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.reviewRequest.deleteMany(),
    prisma.reminder.deleteMany(),
    prisma.message.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.messageTemplate.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.businessMember.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.authSession.deleteMany(),
    prisma.authIdentity.deleteMany(),
    prisma.business.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

interface RegisteredAccount {
  token: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  businessId: string;
}

export async function registerAccount(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; fullName: string; businessName: string }> = {},
): Promise<RegisteredAccount> {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email,
      password: overrides.password ?? "password123",
      fullName: overrides.fullName ?? "Test User",
      businessName: overrides.businessName ?? "Test Business",
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${response.body}`);
  }

  const body = response.json();
  return {
    token: body.token,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
    businessId: body.business.id,
  };
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}
