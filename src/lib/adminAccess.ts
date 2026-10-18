import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { normalizeEmail } from "./email.js";
import { extractCloudflareAccessToken, verifyCloudflareAccessToken } from "./cloudflareAccess.js";

export async function verifyAdminAccess(request: FastifyRequest): Promise<string | undefined> {
  if (!config.CF_ACCESS_ENABLED) return undefined;
  try {
    return (await verifyCloudflareAccessToken(extractCloudflareAccessToken(request))).email;
  } catch {
    throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Cloudflare Access verification failed");
  }
}

export function requireMatchingAdminAccess(verifiedEmail: string | undefined, adminEmail: string): void {
  if (config.CF_ACCESS_ENABLED && (!verifiedEmail || normalizeEmail(verifiedEmail) !== normalizeEmail(adminEmail))) {
    throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Cloudflare Access identity does not match the admin identity");
  }
}
