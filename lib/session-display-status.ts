import {
  NegotiationState,
  ParticipantType,
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
};

export function hasRequiredParticipants(
  participants: SessionParticipantLike[],
): boolean {
  const participantCount = participants.filter(
    (participant) => participant.type === ParticipantType.PARTICIPANT,
  ).length;
  const hasFacilitator = participants.some(
    (participant) => participant.type === ParticipantType.FACILITATOR,
  );

  return (
    participantCount >= REQUIRED_PARTICIPANT_COUNT && hasFacilitator
  );
}

function hasEnteredVideoRoom(participants: SessionParticipantLike[]): boolean {
  return participants
    .filter(
      (participant) =>
        participant.type === ParticipantType.PARTICIPANT ||
        participant.type === ParticipantType.FACILITATOR,
    )
    .some((participant) => participant.joinedAt != null);
}

export function resolvePrepStatus(
  participants: SessionParticipantLike[],
): SessionStatus {
  return hasRequiredParticipants(participants)
    ? SessionStatus.READY
    : SessionStatus.DRAFT;
}

export function resolveSessionDisplayStatus(
  session: SessionStatusInput,
  participants: SessionParticipantLike[],
): SessionDisplayStatus {
  if (session.negotiationState !== NegotiationState.PREPARATION) {
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
