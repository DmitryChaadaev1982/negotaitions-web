import type {
  NegotiationState,
  ParticipantType,
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";

export const SESSION_DISPLAY_STATUSES = [
  "DRAFT",
  "READY",
  "PREPARATION",
  "PREPARATION_RUNNING",
  "PREPARATION_PAUSED",
  "READY_TO_START",
  "RUNNING",
  "PAUSED",
  "DEBRIEF",
  "FINISHED",
] as const;

export type SessionDisplayStatus = (typeof SESSION_DISPLAY_STATUSES)[number];

export const REQUIRED_PARTICIPANT_COUNT = 2;

export type SessionParticipantLike = {
  type: ParticipantType;
  joinedAt?: Date | null;
};

export type SessionStatusInput = {
  status: SessionStatus;
  negotiationState: NegotiationState;
  roomLifecycle: RoomLifecycle | null;
};

export function isCompletedSessionDisplayStatus(
  status: SessionDisplayStatus,
): boolean {
  return status === "FINISHED";
}

export function isPostNegotiationSessionDisplayStatus(
  status: SessionDisplayStatus | null,
): boolean {
  return status === "DEBRIEF" || status === "FINISHED";
}

export function isCanonicallyCompletedSession(
  session: SessionStatusInput,
): boolean {
  if (session.negotiationState !== "FINISHED") {
    return false;
  }

  if (session.roomLifecycle === "CLOSED") {
    return true;
  }

  // Modern finish paths persist OPEN as a recovery fence before canonical
  // completion changes it to DEBRIEF_OPEN, or assign DEBRIEF_OPEN/CLOSED in
  // the same transaction. A FINISHED row that still has no lifecycle is
  // therefore pre-lifecycle history. Room access already treats that legacy
  // shape as CLOSED, so display/grouping must do the same. Explicit OPEN and
  // DEBRIEF_OPEN remain nonterminal regardless of the coarse Session.status.
  return session.roomLifecycle == null;
}

export function hasRequiredParticipants(
  participants: SessionParticipantLike[],
): boolean {
  const participantCount = participants.filter(
    (participant) => participant.type === "PARTICIPANT",
  ).length;
  const hasFacilitator = participants.some(
    (participant) => participant.type === "FACILITATOR",
  );

  return (
    participantCount >= REQUIRED_PARTICIPANT_COUNT && hasFacilitator
  );
}

function hasEnteredVideoRoom(participants: SessionParticipantLike[]): boolean {
  return participants
    .filter(
      (participant) =>
        participant.type === "PARTICIPANT" ||
        participant.type === "FACILITATOR",
    )
    .some((participant) => participant.joinedAt != null);
}

export function resolvePrepStatus(
  participants: SessionParticipantLike[],
): SessionStatus {
  return hasRequiredParticipants(participants)
    ? "READY"
    : "DRAFT";
}

export function resolveSessionDisplayStatus(
  session: SessionStatusInput,
  participants: SessionParticipantLike[],
): SessionDisplayStatus {
  if (isCanonicallyCompletedSession(session)) {
    // FINISHED is the existing terminal display code whose localized label is
    // Completed. Room lifecycle, not coarse Session.status, is authoritative.
    return "FINISHED";
  }

  if (session.negotiationState === "FINISHED") {
    return "DEBRIEF";
  }

  if (session.negotiationState !== "PREPARATION") {
    return session.negotiationState;
  }

  if (!hasRequiredParticipants(participants)) {
    return "DRAFT";
  }

  if (!hasEnteredVideoRoom(participants)) {
    return "READY";
  }

  return "PREPARATION";
}

export function isJoinableObserverDebriefSession(session: {
  negotiationState: string;
  roomLifecycle: string | null;
  sessionDisplayState?: string;
  displayStatus?: string | null;
}): boolean {
  if (session.displayStatus === "DEBRIEF" || session.roomLifecycle === "DEBRIEF_OPEN") {
    return true;
  }

  // A joinable Observer session cannot be terminal. FINISHED + joinable is Debrief
  // even if the client payload is missing roomLifecycle.
  return (
    session.sessionDisplayState === "joinable" &&
    session.negotiationState === "FINISHED" &&
    session.roomLifecycle !== "CLOSED"
  );
}
