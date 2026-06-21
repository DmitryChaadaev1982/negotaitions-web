import { z } from "zod";

import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
} from "@/lib/negotiation-duration";

export const negotiationDurationMinutesSchema = z.coerce
  .number()
  .int("Duration must be a whole number of minutes")
  .min(
    MIN_NEGOTIATION_DURATION_MINUTES,
    `Duration must be at least ${MIN_NEGOTIATION_DURATION_MINUTES} minute`,
  )
  .max(
    MAX_NEGOTIATION_DURATION_MINUTES,
    `Duration must be at most ${MAX_NEGOTIATION_DURATION_MINUTES} minutes`,
  );

export const defaultNegotiationDurationMinutesSchema =
  negotiationDurationMinutesSchema.optional();

export const caseRoleSchema = z.object({
  name: z.string().trim().min(1, "Role name is required"),
  privateInstructions: z
    .string()
    .trim()
    .min(1, "Private instructions are required"),
});

export const createCaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  businessContext: z.string().trim().min(1, "Business context is required"),
  publicInstructions: z
    .string()
    .trim()
    .min(1, "Public instructions are required"),
  negotiationDurationMinutes: defaultNegotiationDurationMinutesSchema,
  roles: z
    .array(caseRoleSchema)
    .min(2, "At least two roles are required")
    .max(4, "A case can have at most four roles"),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type CaseRoleInput = z.infer<typeof caseRoleSchema>;
