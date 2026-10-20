import { z } from "zod";

/**
 * Upper bound on any password we hash or verify. Argon2id cost grows with
 * input size, so an unbounded field lets one request burn a CPU core.
 * Sign-in allows more than new passwords so no existing password is locked out.
 */
export const NEW_PASSWORD_MAX = 128;
export const SIGN_IN_PASSWORD_MAX = 1024;

// The most-guessed passwords that pass an 8-character minimum. Credential
// stuffing tries these first, so a reset or change can't land on one.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
  "12345678", "123456789", "1234567890", "12341234", "11111111", "00000000", "87654321", "123123123",
  "qwertyui", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "asdfghjk", "asdf1234",
  "iloveyou", "iloveyou1", "sunshine", "princess", "football", "baseball", "superman", "starwars",
  "welcome1", "welcome123", "letmein1", "trustno1", "abc12345", "abcd1234", "admin123", "administrator",
  "changeme", "chakusa1", "chakusa123", "monkey123", "dragon123", "master123", "computer", "whatever",
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}

/** A password being set (registration). */
export const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(NEW_PASSWORD_MAX, `Password must be at most ${NEW_PASSWORD_MAX} characters`);

/** A password set by reset or change: also refuses well-known passwords. */
export const replacementPasswordField = passwordField.refine((value) => !isCommonPassword(value), {
  message: "That password is too common. Choose one that is harder to guess.",
});

/** A password typed to sign in or confirm identity. */
export const signInPasswordField = z.string().min(1).max(SIGN_IN_PASSWORD_MAX);
