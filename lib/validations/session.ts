import { z } from "zod";

import { negotiationDurationMinutesSchema, preparationDurationMinutesSchema } from "@/lib/validations/case";

export const createSessionSchema = z.object({
  title: z.string().trim().min(1, "titleRequired"),
  caseId: z.string().trim().min(1, "caseIdRequired"),
  preparationDurationMinutes: preparationDurationMinutesSchema,
  negotiationDurationMinutes: negotiationDurationMinutesSchema,
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
  facilitatorUserId: z.string().trim().min(1).optional(),
  invitedUserIds: z.array(z.string().min(1)).default([]),
  invitedEmails: z.array(z.string().trim().email("invalidEmailAddress")).default([]),
});

export const updateSessionDurationSchema = z.object({
  sessionId: z.string().trim().min(1, "sessionNotFound"),
  durationMinutes: negotiationDurationMinutesSchema.optional(),
  preparationDurationMinutes: preparationDurationMinutesSchema.optional(),
}).refine(
  (data) =>
    data.durationMinutes !== undefined ||
    data.preparationDurationMinutes !== undefined,
  { message: "durationRequired" },
);

export const addParticipantSchema = z
  .object({
    sessionId: z.string().trim().min(1, "sessionNotFound"),
    displayName: z.string().trim().min(1, "displayNameRequired"),
    type: z.enum(["PARTICIPANT", "OBSERVER", "FACILITATOR"], {
      message: "nameRequired",
    }),
    sessionRoleId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PARTICIPANT" && !data.sessionRoleId?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "caseRoleRequired",
        path: ["sessionRoleId"],
      });
    }

    if (data.type !== "PARTICIPANT" && data.sessionRoleId?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "caseRoleRequired",
        path: ["sessionRoleId"],
      });
    }
  });

/**
 * Phase 6.11B: sessionRoleId is now optional for PARTICIPANT type.
 * Facilitator can add an unassigned participant and assign a role later via
 * the role management panel. Roles are assigned via assignParticipantRoleSchema.
 */
export const addAccountParticipantSchema = z.object({
  sessionId: z.string().trim().min(1, "sessionNotFound"),
  type: z.enum(["PARTICIPANT", "OBSERVER"], { message: "nameRequired" }),
  sessionRoleId: z.string().trim().optional(),
});

/**
 * Phase 6.11B: Role assignment/reassignment for already-joined participants.
 * Only facilitator/admin can call this; validated server-side.
 */
export const assignParticipantRoleSchema = z.object({
  sessionId: z.string().trim().min(1),
  assignments: z.array(
    z.object({
      sessionParticipantId: z.string().trim().min(1),
      sessionRoleId: z.string().trim().min(1).nullable(),
    }),
  ).min(1),
});

export const saveParticipantNotesSchema = z.object({
  joinToken: z.string().trim().min(1, "invalidJoinLink"),
  notes: z.string(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;
export type AddAccountParticipantInput = z.infer<typeof addAccountParticipantSchema>;
export type AssignParticipantRoleInput = z.infer<typeof assignParticipantRoleSchema>;
