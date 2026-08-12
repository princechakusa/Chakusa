import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * A fixed Argon2id hash of a value no real password will ever equal.
 * Used to run the same-cost verify() call for nonexistent-user login
 * attempts, so response timing doesn't reveal whether an email is
 * registered (see verifyPasswordConstantTime).
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$fjI6/itc+gL9xkDezm6utg$MXR3+zNk4eaI4vIZrepfix6IIdzyNVyBQLsSheI+yqE";

export async function verifyPasswordConstantTime(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!hash) {
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    return false;
  }
  return verifyPassword(hash, password);
}
