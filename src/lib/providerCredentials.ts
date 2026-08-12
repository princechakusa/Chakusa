import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

const VERSION = "v1";

function encryptionKey() {
  if (!config.PROVIDER_TOKEN_ENCRYPTION_KEY) {
    throw ApiError.auth(503, "APPLE_AUTH_NOT_CONFIGURED", "Apple authentication is not configured");
  }
  const key = Buffer.from(config.PROVIDER_TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw ApiError.auth(503, "APPLE_AUTH_NOT_CONFIGURED", "Apple credential encryption is not configured correctly");
  }
  return key;
}

export function encryptProviderCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptProviderCredential(payload: string) {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted provider credential");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
