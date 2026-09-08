import { z } from "zod";

// Coarse on purpose: 5 decimal places is ~1.1 m, enough for "provider is
// near", and it matches the Decimal(8,5) column. Anything finer is discarded.
const latitude = z.number().gte(-90).lte(90);
const longitude = z.number().gte(-180).lte(180);
const accuracyMeters = z.number().int().min(0).max(100_000).optional();

export const startLocationShareSchema = z.object({ latitude, longitude, accuracyMeters });
export const updateLocationShareSchema = z.object({ latitude, longitude, accuracyMeters });

export type StartLocationShareInput = z.infer<typeof startLocationShareSchema>;
export type UpdateLocationShareInput = z.infer<typeof updateLocationShareSchema>;
