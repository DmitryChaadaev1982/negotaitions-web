import { z } from "zod";

export const liveKitTokenRequestSchema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
});
