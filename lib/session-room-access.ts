import {
  NegotiationState,
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

export function isRoomAccessAllowed(output: RoomAccessDecisionOutput): boolean {
  return output === "ALLOW_ACTIVE_ROOM" || output === "ALLOW_DEBRIEF";
}
