export const OBSERVER_DRAFT_VALUE = "__observer__" as const;

export type DraftAssignmentValue = string | typeof OBSERVER_DRAFT_VALUE | null;

export type SessionRoleParticipantState = {
  id: string;
  type: string;
  currentRoleId: string | null;
};

type SessionRoleOption = {
  id: string;
  name: string;
};

export type RoleOptionAvailability = SessionRoleOption & {
  disabled: boolean;
  disabledReason: "alreadyAssigned" | "assignedToAnotherParticipant" | null;
};

function normalizeParticipantDraftValue(
  participant: SessionRoleParticipantState,
): DraftAssignmentValue {
  return participant.type === "OBSERVER"
    ? OBSERVER_DRAFT_VALUE
    : participant.currentRoleId;
}

function normalizeDraftValueForSignature(value: DraftAssignmentValue): string {
  if (value === OBSERVER_DRAFT_VALUE) {
    return "observer";
  }

  if (!value) {
    return "unassigned";
  }

  return value;
}

export function deriveRoleAssignmentDraft(
  participants: SessionRoleParticipantState[],
): Record<string, DraftAssignmentValue> {
  const draft: Record<string, DraftAssignmentValue> = {};

  for (const participant of participants) {
    draft[participant.id] = normalizeParticipantDraftValue(participant);
  }

  return draft;
}

export function deriveRoleAssignmentSignature(
  participants: SessionRoleParticipantState[],
): string {
  return participants
    .map((participant) => {
      const normalizedValue = normalizeDraftValueForSignature(
        normalizeParticipantDraftValue(participant),
      );
      return `${participant.id}:${participant.type}:${normalizedValue}`;
    })
    .sort()
    .join("|");
}

export function hasRoleAssignmentDraftChanges(params: {
  participants: SessionRoleParticipantState[];
  draft: Record<string, DraftAssignmentValue>;
}): boolean {
  for (const participant of params.participants) {
    const expectedValue = normalizeParticipantDraftValue(participant);
    const currentValue =
      params.draft[participant.id] === undefined
        ? null
        : params.draft[participant.id];

    if (currentValue !== expectedValue) {
      return true;
    }
  }

  return false;
}

function deriveOccupiedRoleByParticipant(params: {
  participants: SessionRoleParticipantState[];
  draft: Record<string, DraftAssignmentValue>;
}): Map<string, string> {
  const occupiedByRoleId = new Map<string, string>();

  for (const participant of params.participants) {
    const draftValue = params.draft[participant.id] ?? null;
    const isParticipantWithRole =
      participant.type === "PARTICIPANT" &&
      draftValue !== OBSERVER_DRAFT_VALUE &&
      typeof draftValue === "string";

    if (isParticipantWithRole) {
      occupiedByRoleId.set(draftValue, participant.id);
    }
  }

  return occupiedByRoleId;
}

export function derivePanelRoleOptionAvailability(params: {
  participantId: string;
  participants: SessionRoleParticipantState[];
  draft: Record<string, DraftAssignmentValue>;
  roles: SessionRoleOption[];
}): RoleOptionAvailability[] {
  const occupiedByRoleId = deriveOccupiedRoleByParticipant({
    participants: params.participants,
    draft: params.draft,
  });

  return params.roles.map((role) => {
    const occupiedByParticipantId = occupiedByRoleId.get(role.id);
    const occupiedByAnotherParticipant =
      occupiedByParticipantId != null &&
      occupiedByParticipantId !== params.participantId;
    const disabledReason: RoleOptionAvailability["disabledReason"] =
      occupiedByAnotherParticipant ? "assignedToAnotherParticipant" : null;

    return {
      ...role,
      disabled: occupiedByAnotherParticipant,
      disabledReason,
    };
  });
}

export function deriveAddParticipantRoleOptionAvailability(params: {
  roles: SessionRoleOption[];
  assignedRoleIds: string[];
}): { options: RoleOptionAvailability[]; allRolesAssigned: boolean } {
  const assignedRoleIdSet = new Set(params.assignedRoleIds);
  let availableRoleCount = 0;

  const options = params.roles.map((role) => {
    const isAssigned = assignedRoleIdSet.has(role.id);
    const disabledReason: RoleOptionAvailability["disabledReason"] = isAssigned
      ? "alreadyAssigned"
      : null;

    if (!isAssigned) {
      availableRoleCount += 1;
    }

    return {
      ...role,
      disabled: isAssigned,
      disabledReason,
    };
  });

  return {
    options,
    allRolesAssigned: params.roles.length > 0 && availableRoleCount === 0,
  };
}
