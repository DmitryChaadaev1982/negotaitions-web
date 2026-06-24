import type { CaseLanguage, Difficulty } from "@/app/generated/prisma/client";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";

export type PublicCaseSummary = {
  id: string;
  title: string;
  caseLanguage: CaseLanguage;
  difficulty: Difficulty;
  businessContext: string;
  publicInstructions: string;
  targetSkills: string;
  defaultPreparationDurationSeconds: number;
  defaultPreparationDurationMinutes: number;
  defaultDurationSeconds: number;
  defaultDurationMinutes: number;
  roleNames: string[];
  roles: Array<{ id: string; name: string }>;
};

export function toPublicCaseSummary(
  negotiationCase: {
    id: string;
    title: string;
    caseLanguage: CaseLanguage;
    difficulty: Difficulty;
    businessContext: string;
    publicInstructions: string;
    targetSkills: string;
    defaultPreparationDurationSeconds: number;
    defaultDurationSeconds: number;
    roles: Array<{ id: string; name: string; sortOrder: number }>;
  },
): PublicCaseSummary {
  const assignableRoles = negotiationCase.roles
    .filter((role) => isAssignableCaseRole(role.name))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const roleNames = assignableRoles.map((role) => role.name);

  return {
    id: negotiationCase.id,
    title: negotiationCase.title,
    caseLanguage: negotiationCase.caseLanguage,
    difficulty: negotiationCase.difficulty,
    businessContext: negotiationCase.businessContext,
    publicInstructions: negotiationCase.publicInstructions,
    targetSkills: negotiationCase.targetSkills,
    defaultPreparationDurationSeconds:
      negotiationCase.defaultPreparationDurationSeconds,
    defaultPreparationDurationMinutes: secondsToDisplayMinutes(
      negotiationCase.defaultPreparationDurationSeconds,
    ),
    defaultDurationSeconds: negotiationCase.defaultDurationSeconds,
    defaultDurationMinutes: secondsToDisplayMinutes(
      negotiationCase.defaultDurationSeconds,
    ),
    roleNames,
    roles: assignableRoles.map((role) => ({ id: role.id, name: role.name })),
  };
}
