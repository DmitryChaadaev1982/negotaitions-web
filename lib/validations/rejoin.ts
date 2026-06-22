import { z } from "zod";

export const rejoinValidateSchema = z.object({
  type: z.enum(["EVENT_LOBBY", "SESSION_JOIN", "SESSION_ROOM"]),
  eventId: z.string().optional(),
  sessionId: z.string().optional(),
  hostToken: z.string().optional(),
  participantToken: z.string().optional(),
  joinToken: z.string().optional(),
});

export const eventHeartbeatSchema = z.object({
  hostToken: z.string().optional(),
  participantToken: z.string().optional(),
});

export const sessionHeartbeatSchema = z.object({
  joinToken: z.string().min(1),
});
