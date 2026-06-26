import { z } from "zod";

import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MAX_PREPARATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  MIN_PREPARATION_DURATION_MINUTES,
} from "@/lib/negotiation-duration";

export const negotiationDurationMinutesSchema = z.coerce
  .number()
  .int("durationWholeMinutes")
  .min(MIN_NEGOTIATION_DURATION_MINUTES, "durationMin")
  .max(MAX_NEGOTIATION_DURATION_MINUTES, "durationMax");

export const preparationDurationMinutesSchema = z.coerce
  .number()
  .int("durationWholeMinutes")
  .min(MIN_PREPARATION_DURATION_MINUTES, "preparationDurationMin")
  .max(MAX_PREPARATION_DURATION_MINUTES, "preparationDurationMax");

export const defaultNegotiationDurationMinutesSchema =
  negotiationDurationMinutesSchema.optional();

export const defaultPreparationDurationMinutesSchema =
  preparationDurationMinutesSchema.optional();

export const caseRoleSchema = z.object({
  name: z.string().trim().min(1, "roleNameRequired"),
  privateInstructions: z
    .string()
    .trim()
    .min(1, "privateInstructionsRequired"),
});

export const caseDifficultySchema = z.enum(["EASY", "MEDIUM", "HARD"]);

export const createCaseSchema = z.object({
  title: z.string().trim().min(1, "titleRequired"),
  businessContext: z.string().trim().min(1, "businessContextRequired"),
  publicInstructions: z
    .string()
    .trim()
    .min(1, "publicInstructionsRequired"),
  difficulty: caseDifficultySchema.default("MEDIUM"),
  caseLanguage: z.enum(["RU", "EN"]).default("EN"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
  preparationDurationMinutes: defaultPreparationDurationMinutesSchema,
  negotiationDurationMinutes: defaultNegotiationDurationMinutesSchema,
  roles: z
    .array(caseRoleSchema)
    .min(2, "atLeastTwoRoles")
    .max(4, "atMostFourRoles"),
});

export const updateCaseSchema = createCaseSchema.extend({
  caseId: z.string().trim().min(1, "caseIdRequired"),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;
export type CaseRoleInput = z.infer<typeof caseRoleSchema>;
