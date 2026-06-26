import { z } from "zod";

import { negotiationDurationMinutesSchema, preparationDurationMinutesSchema } from "@/lib/validations/case";

export const createSessionSchema = z.object({
  title: z.string().trim().min(1, "titleRequired"),
  caseId: z.string().trim().min(1, "caseIdRequired"),
  preparationDurationMinutes: preparationDurationMinutesSchema,
  negotiationDurationMinutes: negotiationDurationMinutesSchema,
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
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

export const saveParticipantNotesSchema = z.object({
  joinToken: z.string().trim().min(1, "invalidJoinLink"),
  notes: z.string(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;
