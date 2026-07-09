import {
  deriveRoleSlotSummary,
  type RoleSlotSummaryEntry,
} from "@/lib/session-role-ui-state";

import type { EventAssignmentDraft } from "@/lib/event-assignment";

type EventRoleOption = {
  id: string;
  name: string;
};

export type EventAssignmentParticipant = {
  id: string;
  displayName: string;
  activeAssignmentLabel: string | null;
};

export type EventRoleOptionAvailability = EventAssignmentParticipant & {
  disabled: boolean;
  disabledReason:
    | "assignedToAnotherRole"
    | "selectedAsFacilitator"
    | "alreadyInActiveSession"
    | null;
};

export type EventFacilitatorOptionAvailability = EventAssignmentParticipant & {
  disabled: boolean;
  disabledReason:
    | "selectedAsRolePlayer"
    | "alreadyInActiveSession"
    | null;
};

export type EventObserverOptionAvailability = EventAssignmentParticipant & {
  disabled: boolean;
  disabledReason:
    | "selectedAsRolePlayer"
    | "selectedAsFacilitator"
    | "alreadyInActiveSession"
    | null;
};

function isParticipantBusy(participant: EventAssignmentParticipant): boolean {
  return Boolean(participant.activeAssignmentLabel);
}

function deriveAssignedRoleByParticipant(
  roleAssignments: Record<string, string>,
): Map<string, string> {
  const byParticipantId = new Map<string, string>();

  for (const [roleId, participantId] of Object.entries(roleAssignments)) {
    if (!participantId || byParticipantId.has(participantId)) {
      continue;
    }
    byParticipantId.set(participantId, roleId);
  }

  return byParticipantId;
}

export function normalizeEventAssignmentDraft(params: {
  draft: EventAssignmentDraft;
  roles: EventRoleOption[];
  participants: EventAssignmentParticipant[];
}): EventAssignmentDraft {
  const roleIdSet = new Set(params.roles.map((role) => role.id));
  const participantById = new Map(
    params.participants.map((participant) => [participant.id, participant] as const),
  );

  const nextRoleAssignments: Record<string, string> = {};
  const assignedParticipantIds = new Set<string>();

  for (const role of params.roles) {
    const selectedParticipantId = params.draft.roleAssignments[role.id];

    if (!selectedParticipantId || !roleIdSet.has(role.id)) {
      continue;
    }

    const participant = participantById.get(selectedParticipantId);
    if (!participant || isParticipantBusy(participant)) {
      continue;
    }
    if (selectedParticipantId === params.draft.facilitatorEventParticipantId) {
      continue;
    }
    if (assignedParticipantIds.has(selectedParticipantId)) {
      continue;
    }

    assignedParticipantIds.add(selectedParticipantId);
    nextRoleAssignments[role.id] = selectedParticipantId;
  }

  const observerEventParticipantIds: string[] = [];
  const seenObserverIds = new Set<string>();
  for (const observerId of params.draft.observerEventParticipantIds) {
    const participant = participantById.get(observerId);
    if (!participant || isParticipantBusy(participant)) {
      continue;
    }
    if (seenObserverIds.has(observerId)) {
      continue;
    }
    if (observerId === params.draft.facilitatorEventParticipantId) {
      continue;
    }
    if (assignedParticipantIds.has(observerId)) {
      continue;
    }

    seenObserverIds.add(observerId);
    observerEventParticipantIds.push(observerId);
  }

  const facilitator =
    params.draft.facilitatorEventParticipantId != null
      ? participantById.get(params.draft.facilitatorEventParticipantId)
      : null;
  const facilitatorEventParticipantId =
    facilitator && !isParticipantBusy(facilitator)
      ? params.draft.facilitatorEventParticipantId
      : null;

  return {
    ...params.draft,
    facilitatorEventParticipantId,
    roleAssignments: nextRoleAssignments,
    observerEventParticipantIds,
  };
}

export function deriveEventRoleSlotSummary(params: {
  roles: EventRoleOption[];
  participants: EventAssignmentParticipant[];
  roleAssignments: Record<string, string>;
}): { slots: RoleSlotSummaryEntry[]; allRolesAssigned: boolean } {
  const assignedRoleByParticipant = deriveAssignedRoleByParticipant(
    params.roleAssignments,
  );
  const participantDraft: Record<string, string | null> = {};

  for (const participant of params.participants) {
    participantDraft[participant.id] = assignedRoleByParticipant.get(participant.id) ?? null;
  }

  return deriveRoleSlotSummary({
    roles: params.roles,
    participants: params.participants.map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      type: "PARTICIPANT",
      currentRoleId: null,
    })),
    draft: participantDraft,
  });
}

export function deriveEventFacilitatorOptionAvailability(params: {
  participants: EventAssignmentParticipant[];
  roleAssignments: Record<string, string>;
}): EventFacilitatorOptionAvailability[] {
  const assignedRoleByParticipant = deriveAssignedRoleByParticipant(
    params.roleAssignments,
  );

  return params.participants.map((participant) => {
    const disabledReason: EventFacilitatorOptionAvailability["disabledReason"] =
      isParticipantBusy(participant)
        ? "alreadyInActiveSession"
        : assignedRoleByParticipant.has(participant.id)
          ? "selectedAsRolePlayer"
          : null;

    return {
      ...participant,
      disabled: disabledReason !== null,
      disabledReason,
    };
  });
}

export function deriveEventRoleOptionAvailability(params: {
  roleId: string;
  participants: EventAssignmentParticipant[];
  facilitatorEventParticipantId: string | null;
  roleAssignments: Record<string, string>;
}): EventRoleOptionAvailability[] {
  const assignedRoleByParticipant = deriveAssignedRoleByParticipant(
    params.roleAssignments,
  );

  return params.participants.map((participant) => {
    const assignedRoleId = assignedRoleByParticipant.get(participant.id) ?? null;
    const isAssignedToAnotherRole =
      assignedRoleId !== null && assignedRoleId !== params.roleId;
    const disabledReason: EventRoleOptionAvailability["disabledReason"] =
      isParticipantBusy(participant)
        ? "alreadyInActiveSession"
        : params.facilitatorEventParticipantId === participant.id
          ? "selectedAsFacilitator"
          : isAssignedToAnotherRole
            ? "assignedToAnotherRole"
            : null;

    return {
      ...participant,
      disabled: disabledReason !== null,
      disabledReason,
    };
  });
}

export function deriveEventObserverOptionAvailability(params: {
  participants: EventAssignmentParticipant[];
  facilitatorEventParticipantId: string | null;
  roleAssignments: Record<string, string>;
}): EventObserverOptionAvailability[] {
  const assignedRoleByParticipant = deriveAssignedRoleByParticipant(
    params.roleAssignments,
  );

  return params.participants.map((participant) => {
    const disabledReason: EventObserverOptionAvailability["disabledReason"] =
      isParticipantBusy(participant)
        ? "alreadyInActiveSession"
        : params.facilitatorEventParticipantId === participant.id
          ? "selectedAsFacilitator"
          : assignedRoleByParticipant.has(participant.id)
            ? "selectedAsRolePlayer"
            : null;

    return {
      ...participant,
      disabled: disabledReason !== null,
      disabledReason,
    };
  });
}

export function deriveUnassignedRoleEligibleParticipantIds(params: {
  participants: EventAssignmentParticipant[];
  facilitatorEventParticipantId: string | null;
  roleAssignments: Record<string, string>;
}): string[] {
  const assignedRoleByParticipant = deriveAssignedRoleByParticipant(
    params.roleAssignments,
  );

  return params.participants
    .filter((participant) => {
      if (isParticipantBusy(participant)) {
        return false;
      }
      if (params.facilitatorEventParticipantId === participant.id) {
        return false;
      }
      if (assignedRoleByParticipant.has(participant.id)) {
        return false;
      }
      return true;
    })
    .map((participant) => participant.id);
}
