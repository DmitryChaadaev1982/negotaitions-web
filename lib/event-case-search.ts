import type { CaseLanguage, Difficulty } from "@/app/generated/prisma/client";
import type { PublicCaseSummary } from "@/lib/event-case-public";

export type CaseLibraryFilters = {
  query: string;
  language: CaseLanguage | "ALL";
  difficulty: Difficulty | "ALL";
};

export function filterEventCases(
  cases: PublicCaseSummary[],
  filters: CaseLibraryFilters,
): PublicCaseSummary[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return cases.filter((negotiationCase) => {
    if (filters.language !== "ALL" && negotiationCase.caseLanguage !== filters.language) {
      return false;
    }

    if (filters.difficulty !== "ALL" && negotiationCase.difficulty !== filters.difficulty) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      negotiationCase.title,
      negotiationCase.businessContext,
      negotiationCase.publicInstructions,
      negotiationCase.targetSkills,
      ...negotiationCase.roleNames,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}
