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

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must use 24-hour HH:MM time");
const dayHoursSchema = z.object({ enabled: z.boolean(), opensAt: timeSchema, closesAt: timeSchema });
const structuredWorkingHoursSchema = z.object({
  version: z.literal(1),
  days: z.object({
    monday: dayHoursSchema, tuesday: dayHoursSchema, wednesday: dayHoursSchema, thursday: dayHoursSchema,
    friday: dayHoursSchema, saturday: dayHoursSchema, sunday: dayHoursSchema,
  }),
});
// Keep accepting the former summary shape during the mobile release
// transition. New clients always write the versioned seven-day structure.
const legacyWorkingHoursSchema = z.object({ summary: z.string().trim().min(1) });

export const updateBusinessSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  phone: z.string().optional(),
  country: countrySchema.optional(),
  timezone: timezoneSchema.optional(),
  currency: currencySchema.optional(),
  googleReviewLink: z.string().url().optional(),
  // Shown on the public business profile page — what a prospective
  // customer reads before deciding to reach out. Capped well short of a
  // full "about us" essay; this is a page summary, not a blog post.
  description: z.string().trim().max(500, "Description must be 500 characters or fewer").optional(),
  workingHours: z.union([structuredWorkingHoursSchema, legacyWorkingHoursSchema]).optional(),
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
