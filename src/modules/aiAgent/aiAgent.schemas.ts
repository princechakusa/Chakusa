import { z } from "zod";

export const takeoverSchema = z.object({ note: z.string().trim().max(1000).optional() });
export const transferSchema = z.object({ memberId: z.string().uuid(), note: z.string().trim().max(1000).optional() });
export const replySchema = z.object({ body: z.string().trim().min(1).max(4000), pauseAI: z.boolean().default(true) });
export const approveSchema = z.object({ edit: z.string().trim().min(1).max(4000).optional() });
export const rejectSchema = z.object({ escalate: z.boolean().default(false), reason: z.string().trim().max(1000).optional() });
