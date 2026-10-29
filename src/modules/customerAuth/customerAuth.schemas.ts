import { z } from "zod";
import { passwordField, replacementPasswordField, signInPasswordField } from "../../lib/passwordPolicy.js";

const email = z.string().trim().email();
const password = passwordField;

export const customerRegisterSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  // The person's "I am 18 or older" tick. Required: no account is created without it.
  ageConfirmed: z.boolean().optional(),
}).refine((data) => data.ageConfirmed === true, { path: ["ageConfirmed"], message: "You must be 18 or older to create a Chakusa account" });
export const customerLoginSchema = z.object({ email, password: signInPasswordField });
export const customerRefreshSchema = z.object({ refreshToken: z.string().min(1) });
export const customerForgotPasswordSchema = z.object({ email });
export const customerResetPasswordSchema = z.object({ token: z.string().min(1).max(512), password: replacementPasswordField });
export const customerVerifyEmailSchema = z.object({ token: z.string().min(1) });
export const customerGoogleSchema = z.object({ idToken: z.string().min(1).max(16_384), ageConfirmed: z.boolean().optional() });
export const customerAppleSchema = z.object({
  challengeId: z.string().uuid(),
  nonce: z.string().min(32).max(256),
  state: z.string().min(32).max(256),
  identityToken: z.string().min(1).max(16_384),
  authorizationCode: z.string().min(1).max(8_192),
  givenName: z.string().trim().max(100).nullable().optional(),
  familyName: z.string().trim().max(100).nullable().optional(),
  ageConfirmed: z.boolean().optional(),
});
export const customerDeviceSchema = z.object({ token: z.string().min(1).max(4096), platform: z.enum(["ios", "android", "web"]) });
