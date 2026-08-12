import { z } from "zod";

export const registerDeviceSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(["ios", "android", "web"]),
  provider: z.enum(["expo"]).default("expo"),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
