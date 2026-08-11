import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export function generateOpaqueToken(): { id: string; raw: string; hash: string } {
  const id = randomUUID();
  const secret = randomBytes(48).toString("base64url");
  const raw = `${id}.${secret}`;
  return { id, raw, hash: hashToken(raw) };
}

export function parseOpaqueToken(raw: string): string | null {
  const separator = raw.indexOf(".");
  return separator > 0 && separator < raw.length - 1 ? raw.slice(0, separator) : null;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function tokenHashMatches(raw: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(raw), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
