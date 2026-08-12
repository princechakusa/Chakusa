import { z } from "zod";

const email = z.string().trim().email();
const password = z.string().min(8, "Password must be at least 8 characters");

export const registerSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(1, "Full name is required"),
  businessName: z.string().trim().min(1, "Business name is required"),
  industry: z.string().trim().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1) });
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export const logoutSchema = refreshSchema;
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(1), password });
export const deleteAccountSchema = z.union([
  z.object({ password: z.string().min(1) }),
  z.object({ googleIdToken: z.string().min(1).max(16_384) }),
  z.object({ apple: z.object({
    challengeId: z.string().uuid(),
    nonce: z.string().min(32).max(256),
    state: z.string().min(32).max(256),
    identityToken: z.string().min(1).max(16_384),
    authorizationCode: z.string().min(1).max(8_192),
  }) }),
]);
export const googleAuthSchema = z.object({ idToken: z.string().min(1).max(16_384) });

export const appleAuthSchema = z.object({
  challengeId: z.string().uuid(),
  nonce: z.string().min(32).max(256),
  state: z.string().min(32).max(256),
  identityToken: z.string().min(1).max(16_384),
  authorizationCode: z.string().min(1).max(8_192),
  givenName: z.string().trim().max(100).nullable().optional(),
  familyName: z.string().trim().max(100).nullable().optional(),
});
