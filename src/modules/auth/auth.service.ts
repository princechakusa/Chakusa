import { prisma } from "../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { ApiError } from "../../lib/errors.js";
import type { RegisterInput, LoginInput } from "./auth.schemas.js";

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw ApiError.conflict("An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
      },
    });

    const business = await tx.business.create({
      data: {
        ownerId: user.id,
        name: input.businessName,
        industry: input.industry,
      },
    });

    await tx.businessMember.create({
      data: {
        businessId: business.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    return { user, business };
  });

  return result;
}

export async function authenticateUser(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  return user;
}

export async function getUserContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, createdAt: true },
  });
  if (!user) {
    throw ApiError.unauthorized();
  }

  const membership = await prisma.businessMember.findFirst({
    where: { userId },
    include: { business: true },
    orderBy: { createdAt: "asc" },
  });

  return { user, business: membership?.business ?? null, role: membership?.role ?? null };
}
