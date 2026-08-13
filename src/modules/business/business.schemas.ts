import { z } from "zod";
import { isValidCountryCode } from "../../lib/phone.js";

// No onboarding flow collects these yet (Phase 1 foundations only) — this
// just lets the existing generic PATCH /business settings endpoint accept
// them, the same way it already accepts every other business setting.
const countrySchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine(isValidCountryCode, "Must be a valid ISO 3166-1 alpha-2 country code");

const timezoneSchema = z
  .string()
  .refine((value) => Intl.supportedValuesOf("timeZone").includes(value), "Must be a valid IANA timezone");

const currencySchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Must be a 3-letter ISO 4217 currency code");

export const updateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  country: countrySchema.optional(),
  timezone: timezoneSchema.optional(),
  currency: currencySchema.optional(),
  googleReviewLink: z.string().url().optional(),
  workingHours: z.record(z.string(), z.unknown()).optional(),
  defaultServices: z.array(z.string()).optional(),
  reminderDays: z.number().int().positive().optional(),
  preferredTone: z.enum(["friendly", "professional", "casual"]).optional(),
});
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;

export const createBusinessSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  phone: z.string().optional(),
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
