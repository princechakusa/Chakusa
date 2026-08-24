import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(1_000),
});

export const adminSessionParamsSchema = z.object({ id: z.string().uuid() });

export const adminCsrfHeaderSchema = z.string().min(32).max(256);
