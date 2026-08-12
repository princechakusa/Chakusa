import { prisma } from "../prisma.js";
import { ExpoPushProvider } from "./expoPushProvider.js";
import type { PushMessage, PushProvider, PushSendResult } from "./pushProvider.js";

// Swap this to select a different provider; nothing outside this module
// should ever import ExpoPushProvider directly.
const defaultProvider: PushProvider = new ExpoPushProvider();

/**
 * Sends a message to every active device token for a user, then deactivates
 * any token the provider reports as permanently invalid (e.g. the app was
 * uninstalled). This is the reusable sending primitive — it does not decide
 * *when* to send; callers (future notification triggers) own that decision.
 *
 * `provider` defaults to the real Expo provider; tests inject a fake one to
 * exercise the deactivation logic deterministically without a real network
 * call.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage,
  provider: PushProvider = defaultProvider,
): Promise<PushSendResult[]> {
  const devices = await prisma.deviceToken.findMany({
    where: { userId, isActive: true },
    select: { token: true },
  });

  if (devices.length === 0) {
    return [];
  }

  const results = await provider.sendToDevices(devices.map((d) => d.token), message);

  const tokensToDeactivate = results.filter((r) => r.invalidToken).map((r) => r.token);
  if (tokensToDeactivate.length > 0) {
    await prisma.deviceToken.updateMany({
      where: { userId, token: { in: tokensToDeactivate }, isActive: true },
      data: { isActive: false, revokedAt: new Date(), revokedReason: "provider_reported_invalid" },
    });
  }

  return results;
}
