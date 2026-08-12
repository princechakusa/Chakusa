import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { RegisterDeviceInput } from "./devices.schemas.js";

function toPublicDevice(device: { id: string; platform: string; provider: string; isActive: boolean; lastUsedAt: Date; createdAt: Date }) {
  // Never echo the raw token back — the client already knows it, and there
  // is no reason for it to appear in an API response body.
  return {
    id: device.id,
    platform: device.platform,
    provider: device.provider,
    isActive: device.isActive,
    lastUsedAt: device.lastUsedAt,
    createdAt: device.createdAt,
  };
}

/**
 * Registers (or reactivates) a device token for userId, transferring
 * ownership away from any other user who currently holds it active.
 *
 * A physical push token can only ever be active for one user at a time —
 * enforced both here and, as the true source of truth, by a partial unique
 * database index on device_tokens(token) WHERE is_active (see migration
 * 20260812170146_device_token_active_uniqueness). The application-level
 * "deactivate the other owner, then upsert my own row" step handles the
 * common case in one transaction; the Serializable isolation level plus
 * retry-on-conflict handles the rare case where two different users race to
 * register the exact same token at the same instant — Postgres will let at
 * most one of the two upserts leave an active row, and the loser's
 * transaction is retried, at which point it observes the winner's row and
 * simply reassigns it again (idempotent — the caller always ends up owning
 * the token, since retry always re-runs the "deactivate other owner" step).
 */
export async function registerDevice(userId: string, input: RegisterDeviceInput, retries = 0): Promise<ReturnType<typeof toPublicDevice>> {
  try {
    const device = await prisma.$transaction(async (tx) => {
      // Deactivate any other user's active ownership of this exact token
      // before this user claims it. A no-op if no other user holds it.
      await tx.deviceToken.updateMany({
        where: { token: input.token, userId: { not: userId }, isActive: true },
        data: { isActive: false, revokedAt: new Date(), revokedReason: "reassigned_to_another_user" },
      });

      return tx.deviceToken.upsert({
        where: { userId_token: { userId, token: input.token } },
        create: {
          userId,
          token: input.token,
          platform: input.platform,
          provider: input.provider,
          isActive: true,
          lastUsedAt: new Date(),
        },
        update: {
          // Re-registering (e.g. app relaunch, permission re-grant)
          // reactivates a previously deactivated token and refreshes its
          // metadata rather than creating a duplicate row.
          platform: input.platform,
          provider: input.provider,
          isActive: true,
          revokedAt: null,
          revokedReason: null,
          lastUsedAt: new Date(),
        },
      });
    }, { isolationLevel: "Serializable" });

    return toPublicDevice(device);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && retries < 3) {
      // Serialization conflict with a concurrent transaction — safe to
      // retry, the whole operation (including the deactivate step) re-runs.
      return registerDevice(userId, input, retries + 1);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && retries < 3) {
      // Lost the race for the partial unique index on the other user's
      // still-committing row. Retry: the other transaction has since
      // committed or rolled back, so this attempt's deactivate step will
      // now see (and clear) it before upserting our own row.
      return registerDevice(userId, input, retries + 1);
    }
    throw error;
  }
}

export async function removeDevice(userId: string, token: string) {
  const existing = await prisma.deviceToken.findUnique({
    where: { userId_token: { userId, token } },
  });
  if (!existing) {
    throw ApiError.notFound("Device token not found");
  }

  await prisma.deviceToken.update({
    where: { userId_token: { userId, token } },
    data: { isActive: false, revokedAt: new Date(), revokedReason: "user_removed" },
  });
}
