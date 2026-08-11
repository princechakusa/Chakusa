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
export const deleteAccountSchema = z.object({ password: z.string().min(1) });
