export type EventAssignmentDraft = {
  facilitatorEventParticipantId: string | null;
  roleAssignments: Record<string, string>;
  observerEventParticipantIds: string[];
  preparationDurationMinutes: number;
  negotiationDurationMinutes: number;
};

export type EventAssignmentDurationDefaults = {
  preparationDurationMinutes: number;
  negotiationDurationMinutes: number;
};

export function createFreshAssignmentDraft(
  defaults: EventAssignmentDurationDefaults,
): EventAssignmentDraft {
  return {
    facilitatorEventParticipantId: null,
    roleAssignments: {},
    observerEventParticipantIds: [],
    preparationDurationMinutes: defaults.preparationDurationMinutes,
    negotiationDurationMinutes: defaults.negotiationDurationMinutes,
  };
}

export function parseAssignmentDraft(
  value: unknown,
  fallback: EventAssignmentDurationDefaults,
): EventAssignmentDraft {
  if (!value || typeof value !== "object") {
    return {
      facilitatorEventParticipantId: null,
      roleAssignments: {},
      observerEventParticipantIds: [],
      preparationDurationMinutes: fallback.preparationDurationMinutes,
      negotiationDurationMinutes: fallback.negotiationDurationMinutes,
    };
  }

  const draft = value as Record<string, unknown>;

  const legacyDurationMinutes =
    typeof draft.durationMinutes === "number" && draft.durationMinutes > 0
      ? draft.durationMinutes
      : null;

  return {
    facilitatorEventParticipantId:
      typeof draft.facilitatorEventParticipantId === "string"
        ? draft.facilitatorEventParticipantId
        : null,
    roleAssignments:
      draft.roleAssignments && typeof draft.roleAssignments === "object"
        ? (draft.roleAssignments as Record<string, string>)
        : {},
    observerEventParticipantIds: Array.isArray(draft.observerEventParticipantIds)
      ? draft.observerEventParticipantIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    preparationDurationMinutes:
      typeof draft.preparationDurationMinutes === "number" &&
      draft.preparationDurationMinutes >= 0
        ? draft.preparationDurationMinutes
        : fallback.preparationDurationMinutes,
    negotiationDurationMinutes:
      typeof draft.negotiationDurationMinutes === "number" &&
      draft.negotiationDurationMinutes > 0
        ? draft.negotiationDurationMinutes
        : legacyDurationMinutes ?? fallback.negotiationDurationMinutes,
  };
}

export function preferenceFromFlags(input: {
  preference?: string;
  wantsToPlay?: boolean;
  wantsToObserve?: boolean;
  wantsToFacilitate?: boolean;
}) {
  if (input.wantsToFacilitate) return "FACILITATE" as const;
  if (input.wantsToPlay) return "PLAY" as const;
  if (input.wantsToObserve) return "OBSERVE" as const;
  if (input.preference === "PLAY") return "PLAY" as const;
  if (input.preference === "OBSERVE") return "OBSERVE" as const;
  if (input.preference === "FACILITATE") return "FACILITATE" as const;
  return "UNDECIDED" as const;
}

export function flagsFromPreference(preference: string) {
  return {
    wantsToPlay: preference === "PLAY",
    wantsToObserve: preference === "OBSERVE",
    wantsToFacilitate: preference === "FACILITATE",
  };
}
