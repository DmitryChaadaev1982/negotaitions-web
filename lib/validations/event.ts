import { customAlphabet } from "nanoid";
import { z } from "zod";

import {
  MAX_EVENT_DURATION_MINUTES,
  MIN_EVENT_DURATION_MINUTES,
} from "@/lib/negotiation-duration";
import { DEFAULT_EVENT_TIME_ZONE, isValidTimeZone } from "@/lib/timezones";

const publicCodeAlphabet = customAlphabet(
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZ",
  8,
);

export function generatePublicJoinCode() {
  return publicCodeAlphabet();
}

export const createEventSchema = z.object({
  title: z.string().trim().min(1, "titleRequired"),
  description: z.string().trim().optional(),
  scheduledAt: z.string().trim().optional(),
  timeZone: z
    .string()
    .trim()
    .min(1, "invalidTimeZone")
    .refine((value) => isValidTimeZone(value), "invalidTimeZone")
    .default(DEFAULT_EVENT_TIME_ZONE),
  estimatedEventDurationMinutes: z.coerce
    .number()
    .int("durationWholeMinutes")
    .min(MIN_EVENT_DURATION_MINUTES, "durationMin")
    .max(MAX_EVENT_DURATION_MINUTES, "durationMax")
    .optional(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
  facilitatorUserId: z.string().trim().optional(),
  invitedUserIds: z.array(z.string().min(1)).default([]),
  invitedEmails: z.array(z.string().trim().email("invalidEmailAddress")).default([]),
});

export const joinEventSchema = z.object({
  eventId: z.string().min(1),
  preference: z.enum(["UNDECIDED", "PLAY", "OBSERVE", "FACILITATE"]).optional(),
  participantToken: z.string().optional(),
});

export const eventAccessQuerySchema = z.object({
  hostToken: z.string().optional(),
  participantToken: z.string().optional(),
});

export const eventLiveKitTokenSchema = z.object({
  hostToken: z.string().optional(),
  participantToken: z.string().optional(),
});

export const updateEventHostSchema = z.object({
  hostToken: z.string().min(1).optional(),
  selectedCaseId: z.string().nullable().optional(),
  assignmentDraft: z
    .object({
      facilitatorEventParticipantId: z.string().nullable(),
      roleAssignments: z.record(z.string(), z.string()),
      observerEventParticipantIds: z.array(z.string()),
      // Do not trim while drafting: the lobby input syncs on every keystroke, so
      // trailing spaces would disappear before the user can type the next word.
      roomLabel: z.string().max(80).optional(),
      preparationDurationMinutes: z.number().int().min(0).max(60),
      negotiationDurationMinutes: z.number().int().min(1).max(180),
    })
    .optional(),
});

export const updateEventParticipantSchema = z.object({
  participantToken: z.string().min(1).optional(),
  preference: z.enum(["UNDECIDED", "PLAY", "OBSERVE", "FACILITATE"]),
});

export const createEventSessionSchema = z.object({
  hostToken: z.string().min(1).optional(),
  caseId: z.string().min(1).optional(),
  roomLabel: z.string().trim().max(80).optional(),
  preparationDurationSeconds: z.number().int().min(0).max(60 * 60).optional(),
  negotiationDurationSeconds: z.number().int().min(60).max(180 * 60).optional(),
  facilitatorEventParticipantId: z.string().min(1).optional(),
  roleAssignments: z
    .array(
      z.object({
        caseRoleId: z.string().min(1),
        eventParticipantId: z.string().min(1),
      }),
    )
    .optional(),
  observerEventParticipantIds: z.array(z.string().min(1)).optional(),
});

export const completeEventSchema = z.object({
  hostToken: z.string().min(1).optional(),
  reason: z.string().trim().optional(),
});

export const eventPresenceSchema = z.object({
  participantToken: z.string().min(1),
});
