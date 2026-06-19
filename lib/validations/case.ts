import { z } from "zod";

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
  roles: z
    .array(caseRoleSchema)
    .min(2, "At least two roles are required")
    .max(4, "A case can have at most four roles"),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type CaseRoleInput = z.infer<typeof caseRoleSchema>;
