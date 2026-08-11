import "dotenv/config";
import { z } from "zod";

const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  PASSWORD_RESET_URL: z.string().url().default("chakusa://reset-password"),
  RESEND_API_KEY: optionalSecret,
  EMAIL_FROM: optionalSecret,
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production") return;
  if (!env.RESEND_API_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required in production" });
  }
  if (!env.EMAIL_FROM) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_FROM"], message: "EMAIL_FROM is required in production" });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const config = parsed.data;
