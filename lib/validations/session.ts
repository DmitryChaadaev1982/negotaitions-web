import { z } from "zod";

export const createSessionSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  caseId: z.string().trim().min(1, "Case is required"),
});

export const addParticipantSchema = z
  .object({
    sessionId: z.string().trim().min(1, "Session is required"),
    displayName: z.string().trim().min(1, "Display name is required"),
    type: z.enum(["PARTICIPANT", "OBSERVER", "FACILITATOR"], {
      message: "Participant type is required",
    }),
    caseRoleId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PARTICIPANT" && !data.caseRoleId?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Assigned role is required for participants",
        path: ["caseRoleId"],
      });
    }

    if (data.type !== "PARTICIPANT" && data.caseRoleId?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Role assignment is only allowed for participants",
        path: ["caseRoleId"],
      });
    }
  });

export const updateSessionStatusSchema = z.object({
  sessionId: z.string().trim().min(1, "Session is required"),
  status: z.enum(["READY", "IN_PROGRESS", "COMPLETED"], {
    message: "Invalid session status",
  }),
});

export const saveParticipantNotesSchema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  notes: z.string(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;
