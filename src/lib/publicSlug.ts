import { randomInt } from "node:crypto";
import { prisma } from "./prisma.js";

/**
 * Lowercase, hyphenated, alphanumeric-only. Never re-run against an
 * existing business — see the schema comment on Business.publicSlug for why
 * this field is create-once and immutable.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Finds a public slug that isn't already taken, starting from the plain
 * slugified business name and falling back to a random numeric suffix on
 * collision. Bounded retry count rather than an unbounded loop: a business
 * name so generic it collides 20 times in a row is vanishingly unlikely,
 * and a random 6-digit suffix is the final, effectively-unique fallback.
 */
export async function generatePublicSlug(name: string): Promise<string> {
  const base = slugify(name) || "business";

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomInt(1000, 999999)}`;
    const existing = await prisma.business.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  return `${base}-${randomInt(100000, 999999)}`;
}
