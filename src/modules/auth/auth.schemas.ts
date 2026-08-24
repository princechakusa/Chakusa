import { z } from "zod";

const email = z.string().trim().email();
const password = z.string().min(8, "Password must be at least 8 characters");

// businessName is required UNLESS invitationToken is present — an invited
// registration joins the invitation's existing Business rather than
// creating one, so asking the client for a business name there would be
// meaningless (and the server would ignore it either way; see
// auth.service.ts's registerUser). This is enforced via superRefine rather
// than an unconditional .min(1) so normal (non-invited) registration's
// validation behavior is byte-for-byte unchanged.
export const registerSchema = z
  .object({
    email,
    password,
    fullName: z.string().trim().min(1, "Full name is required"),
    businessName: z.string().trim().min(1).optional(),
    industry: z.string().trim().optional(),
    invitationToken: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.invitationToken && !data.businessName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["businessName"], message: "Business name is required" });
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1) });
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export const logoutSchema = refreshSchema;
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(1), password });
export const updateProfileSchema = z.object({ fullName: z.string().trim().min(1).max(120) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).optional(), newPassword: password });
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
// invitationToken is only meaningful on /auth/google and /auth/apple
// (sign-in) for a brand-new user — see auth.service.ts's
// authenticateGoogleIdentity/authenticateAppleIdentity. /google/link and
// /apple/link reuse these same schemas but never read the field.
const invitationToken = z.string().trim().min(1).optional();

export const googleAuthSchema = z.object({ idToken: z.string().min(1).max(16_384), invitationToken });

export const appleAuthSchema = z.object({
  challengeId: z.string().uuid(),
  nonce: z.string().min(32).max(256),
  state: z.string().min(32).max(256),
  identityToken: z.string().min(1).max(16_384),
  authorizationCode: z.string().min(1).max(8_192),
  givenName: z.string().trim().max(100).nullable().optional(),
  familyName: z.string().trim().max(100).nullable().optional(),
  invitationToken,
});
