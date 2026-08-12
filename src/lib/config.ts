import "dotenv/config";
import { z } from "zod";

const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

const booleanFlag = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() === "true" : value),
  z.boolean().default(false),
);

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
  GOOGLE_AUTH_ENABLED: booleanFlag,
  GOOGLE_OAUTH_CLIENT_IDS: optionalSecret,
  APPLE_AUTH_ENABLED: booleanFlag,
  APPLE_CLIENT_ID: optionalSecret,
  APPLE_TEAM_ID: optionalSecret,
  APPLE_KEY_ID: optionalSecret,
  APPLE_PRIVATE_KEY_BASE64: optionalSecret,
  PROVIDER_TOKEN_ENCRYPTION_KEY: optionalSecret,
  APPLE_CHALLENGE_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  EXPO_ACCESS_TOKEN: optionalSecret,
}).superRefine((env, context) => {
  if (env.NODE_ENV !== "production") return;
  if (!env.RESEND_API_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required in production" });
  }
  if (!env.EMAIL_FROM) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_FROM"], message: "EMAIL_FROM is required in production" });
  }
  if (env.GOOGLE_AUTH_ENABLED && !env.GOOGLE_OAUTH_CLIENT_IDS) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["GOOGLE_OAUTH_CLIENT_IDS"], message: "GOOGLE_OAUTH_CLIENT_IDS is required in production when GOOGLE_AUTH_ENABLED=true" });
  }
  if (env.APPLE_AUTH_ENABLED) {
    const appleValues = [env.APPLE_CLIENT_ID, env.APPLE_TEAM_ID, env.APPLE_KEY_ID, env.APPLE_PRIVATE_KEY_BASE64, env.PROVIDER_TOKEN_ENCRYPTION_KEY];
    if (!appleValues.every(Boolean)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["APPLE_CLIENT_ID"], message: "APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_BASE64, and PROVIDER_TOKEN_ENCRYPTION_KEY are all required in production when APPLE_AUTH_ENABLED=true" });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const config = parsed.data;

export const googleOAuthClientIds = config.GOOGLE_OAUTH_CLIENT_IDS
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean) ?? [];
