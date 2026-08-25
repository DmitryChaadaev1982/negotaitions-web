import { isAssignableCaseRole } from "@/lib/case-roles";
import {
  deriveRoleAssignmentDraft,
  deriveRoleSlotSummary,
  type SessionRoleParticipantState,
} from "@/lib/session-role-ui-state";

export const STANDALONE_ROLES_NOT_READY_CODE = "STANDALONE_ROLES_NOT_READY";
export const STANDALONE_ROLES_NOT_READY_ERROR = "standaloneRolesNotReady";

export type StandalonePreparationRoleInput = {
  eventId: string | null | undefined;
  roles: Array<{ id: string; name: string }>;
  participants: Array<{
    type: string;
    sessionRoleId?: string | null;
  }>;
};

export type StandaloneStartPreparationGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: 409;
      body: {
        error: typeof STANDALONE_ROLES_NOT_READY_ERROR;
        code: typeof STANDALONE_ROLES_NOT_READY_CODE;
      };
    };

/**
 * Canonical Standalone START_PREPARATION role-readiness predicate.
 * Event-created Sessions (`eventId` present) are always ready: the new guard
 * does not apply. Used by the control API and the room Start Preparation button.
 */
export function areStandalonePreparationRolesReady(
  params: StandalonePreparationRoleInput,
): boolean {
  if (params.eventId != null && params.eventId !== "") {
    return true;
  }

  const assignableRoles = params.roles.filter((role) =>
    isAssignableCaseRole(role.name),
  );

  if (assignableRoles.length === 0) {
    return true;
  }

  const assignableRoleIds = new Set(assignableRoles.map((role) => role.id));
  const negotiationParticipants = params.participants.filter(
    (participant) => participant.type === "PARTICIPANT",
  );

  const allParticipantsAssigned = negotiationParticipants.every(
    (participant) =>
      typeof participant.sessionRoleId === "string" &&
      assignableRoleIds.has(participant.sessionRoleId),
  );
  if (!allParticipantsAssigned) {
    return false;
  }

  const summaryParticipants: Array<
    SessionRoleParticipantState & { displayName: string }
  > = negotiationParticipants.map((participant, index) => ({
    id: `participant-${index}`,
    type: "PARTICIPANT",
    currentRoleId: participant.sessionRoleId ?? null,
    displayName: "",
  }));

  const summary = deriveRoleSlotSummary({
    roles: assignableRoles,
    participants: summaryParticipants,
    draft: deriveRoleAssignmentDraft(summaryParticipants),
  });

  return summary.allRolesAssigned;
}

export function evaluateStandaloneStartPreparationGuard(
  params: StandalonePreparationRoleInput,
): StandaloneStartPreparationGuardResult {
  if (areStandalonePreparationRolesReady(params)) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 409,
    body: {
      error: STANDALONE_ROLES_NOT_READY_ERROR,
      code: STANDALONE_ROLES_NOT_READY_CODE,
    },
  };
}
