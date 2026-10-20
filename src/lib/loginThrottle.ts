import { ApiError } from "./errors.js";
import { normalizeEmail } from "./email.js";

/**
 * Per-account cap on wrong passwords, on top of the per-IP route limits, so
 * guessing spread across many IPs still stops. Keyed by the email typed, and
 * applied whether or not that account exists, so it reveals nothing. A locked
 * owner can still sign in with Google/Apple or reset their password (a reset
 * clears the lock).
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const MAX_TRACKED = 20_000;

const failures = new Map<string, { count: number; firstAt: number }>();

function current(key: string) {
  const entry = failures.get(key);
  if (entry && Date.now() - entry.firstAt >= WINDOW_MS) {
    failures.delete(key);
    return undefined;
  }
  return entry;
}

export function assertLoginAllowed(email: string): void {
  const entry = current(normalizeEmail(email));
  if (entry && entry.count >= MAX_FAILURES) {
    throw ApiError.auth(429, "AUTH_TOO_MANY_ATTEMPTS", "Too many sign-in attempts for this account. Wait 15 minutes or reset your password.");
  }
}

export function recordLoginFailure(email: string): void {
  const key = normalizeEmail(email);
  const entry = current(key);
  if (entry) entry.count += 1;
  else failures.set(key, { count: 1, firstAt: Date.now() });
  if (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value!);
}

export function clearLoginFailures(email: string): void {
  failures.delete(normalizeEmail(email));
}

/** Test helper. */
export function resetLoginThrottle(): void {
  failures.clear();
}
