import {
  NegotiationState,
  SessionStatus,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import {
  buildAccountSessionMaterialsPath,
  buildSessionMaterialsPath,
} from "@/lib/config";
import { deriveEffectiveRoomLifecycle } from "@/lib/session-room-lifecycle";

export type RoomAccessDecisionOutput =
  | "ALLOW_ACTIVE_ROOM"
  | "ALLOW_DEBRIEF"
  | "REDIRECT_MATERIALS"
  | "REDIRECT_EVENT_RESULTS"
  | "DENY_UNAUTHORIZED"
  | "DENY_DELETED"
  | "STALE_CONNECTION"
  | "EVENT_CLOSED";

type SessionRoomAccessUserContext = {
  isAuthenticated: boolean;
  isAuthorizedMember: boolean;
};

type SessionRoomAccessSessionContext = {
  sessionId: string;
  negotiationState: NegotiationState | string;
  roomLifecycle: RoomLifecycle | null;
  deletedAt?: Date | null;
  closeReason?: string | null;
  closedByEventAt?: Date | null;
  eventId?: string | null;
  eventStatus?: TrainingEventStatus | string | null;
};

type SessionRoomAccessConnectionContext = {
  hasConnectionConflict?: boolean;
};

export type ResolveMaterialsRedirectPathInput = {
  sessionId: string;
  eventId?: string | null;
  eventStatus?: TrainingEventStatus | string | null;
  participantJoinToken?: string | null;
  preferEventResultsForEventOwner?: boolean;
};

export type SessionRoomAccessDecision = {
  output: RoomAccessDecisionOutput;
  redirectTo: string | null;
  effectiveRoomLifecycle: RoomLifecycle;
  isDebrief: boolean;
};

export type LateObserverCreationDenyReason =
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED_MEMBER"
  | "EXISTING_SESSION_PARTICIPANT"
  | "EVENT_COMPLETED"
  | "SESSION_DELETED"
  | "SESSION_FINISHED"
  | "NEGOTIATION_FINISHED"
  | "ROOM_NOT_OPEN"
  | "ROOM_POLICY_DENIED";

export type LateObserverCreationDecision =
  | {
      allowed: true;
      reason: null;
      accessDecision: SessionRoomAccessDecision;
    }
  | {
      allowed: false;
      reason: LateObserverCreationDenyReason;
      accessDecision: SessionRoomAccessDecision | null;
    };

export function resolveSessionClosedRedirectPath(
  input: ResolveMaterialsRedirectPathInput,
): string {
  const eventCompleted = input.eventStatus === TrainingEventStatus.COMPLETED;
  if (eventCompleted && input.eventId && input.preferEventResultsForEventOwner) {
    return `/events/${input.eventId}/lobby`;
  }

  if (input.participantJoinToken) {
    return buildSessionMaterialsPath(input.participantJoinToken);
  }
  return buildAccountSessionMaterialsPath(input.sessionId);
}

export function decideSessionRoomAccess(input: {
  user: SessionRoomAccessUserContext;
  session: SessionRoomAccessSessionContext;
  connection?: SessionRoomAccessConnectionContext;
  redirect: ResolveMaterialsRedirectPathInput;
}): SessionRoomAccessDecision {
  if (!input.user.isAuthenticated || !input.user.isAuthorizedMember) {
    return {
      output: "DENY_UNAUTHORIZED",
      redirectTo: null,
      effectiveRoomLifecycle: RoomLifecycle.CLOSED,
      isDebrief: false,
    };
  }

  if (input.session.deletedAt) {
    return {
      output: "DENY_DELETED",
      redirectTo: null,
      effectiveRoomLifecycle: RoomLifecycle.CLOSED,
      isDebrief: false,
    };
  }

  if (input.connection?.hasConnectionConflict) {
    return {
      output: "STALE_CONNECTION",
      redirectTo: null,
      effectiveRoomLifecycle: RoomLifecycle.CLOSED,
      isDebrief: false,
    };
  }

  const effectiveRoomLifecycle = deriveEffectiveRoomLifecycle({
    roomLifecycle: input.session.roomLifecycle,
    deletedAt: input.session.deletedAt ?? null,
    closedByEventAt: input.session.closedByEventAt ?? null,
    closeReason: input.session.closeReason ?? null,
    negotiationState: input.session.negotiationState,
    eventStatus: input.session.eventStatus ?? null,
  });

  const eventCompleted = input.session.eventStatus === TrainingEventStatus.COMPLETED;
  if (eventCompleted) {
    const redirectTo = resolveSessionClosedRedirectPath(input.redirect);
    return {
      output: "EVENT_CLOSED",
      redirectTo,
      effectiveRoomLifecycle: RoomLifecycle.CLOSED,
      isDebrief: false,
    };
  }

  if (effectiveRoomLifecycle === RoomLifecycle.OPEN) {
    return {
      output: "ALLOW_ACTIVE_ROOM",
      redirectTo: null,
      effectiveRoomLifecycle,
      isDebrief: false,
    };
  }

  if (
    effectiveRoomLifecycle === RoomLifecycle.DEBRIEF_OPEN &&
    input.session.negotiationState === NegotiationState.FINISHED
  ) {
    return {
      output: "ALLOW_DEBRIEF",
      redirectTo: null,
      effectiveRoomLifecycle,
      isDebrief: true,
    };
  }

  const redirectTo = resolveSessionClosedRedirectPath(input.redirect);
  return {
    output: eventCompleted ? "REDIRECT_EVENT_RESULTS" : "REDIRECT_MATERIALS",
    redirectTo,
    effectiveRoomLifecycle: RoomLifecycle.CLOSED,
    isDebrief: false,
  };
}

export function canCreateLateObserverParticipant(input: {
  event: {
    status: TrainingEventStatus | string | null;
  };
  user: SessionRoomAccessUserContext;
  session: SessionRoomAccessSessionContext & {
    eventId: string | null;
    status: SessionStatus | string;
  };
  existingSessionParticipant: boolean;
}): LateObserverCreationDecision {
  if (!input.user.isAuthenticated) {
    return {
      allowed: false,
      reason: "UNAUTHENTICATED",
      accessDecision: null,
    };
  }

  if (!input.user.isAuthorizedMember) {
    return {
      allowed: false,
      reason: "UNAUTHORIZED_MEMBER",
      accessDecision: null,
    };
  }

  if (input.existingSessionParticipant) {
    return {
      allowed: false,
      reason: "EXISTING_SESSION_PARTICIPANT",
      accessDecision: null,
    };
  }

  if (input.event.status === TrainingEventStatus.COMPLETED) {
    return {
      allowed: false,
      reason: "EVENT_COMPLETED",
      accessDecision: null,
    };
  }

  if (input.session.deletedAt) {
    return {
      allowed: false,
      reason: "SESSION_DELETED",
      accessDecision: null,
    };
  }

  const accessDecision = decideSessionRoomAccess({
    user: input.user,
    session: input.session,
    redirect: {
      sessionId: input.session.sessionId,
      eventId: input.session.eventId,
      eventStatus: input.event.status,
      preferEventResultsForEventOwner: false,
    },
  });

  // First Observer entry is allowed for the same room-enterable lifecycles as
  // an already-authorized member, including DEBRIEF_OPEN. Participant creation
  // is not handled here. FINISHED+OPEN recovery remains denied below.
  if (accessDecision.output === "ALLOW_DEBRIEF") {
    return {
      allowed: true,
      reason: null,
      accessDecision,
    };
  }

  if (input.session.status === SessionStatus.COMPLETED) {
    return {
      allowed: false,
      reason: "SESSION_FINISHED",
      accessDecision,
    };
  }

  if (input.session.negotiationState === NegotiationState.FINISHED) {
    return {
      allowed: false,
      reason: "NEGOTIATION_FINISHED",
      accessDecision,
    };
  }

  if (accessDecision.output !== "ALLOW_ACTIVE_ROOM") {
    return {
      allowed: false,
      reason: "ROOM_POLICY_DENIED",
      accessDecision,
    };
  }

  return {
    allowed: true,
    reason: null,
    accessDecision,
  };
}

export function isRoomAccessAllowed(output: RoomAccessDecisionOutput): boolean {
  return output === "ALLOW_ACTIVE_ROOM" || output === "ALLOW_DEBRIEF";
}
