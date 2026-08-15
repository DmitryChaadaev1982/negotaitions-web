import {
  AiAnalysisPublicationProjection,
  ParticipantType,
} from "@/app/generated/prisma/client";

type RoomConnectionIdentity = {
  userId: string;
};

type SessionPublicationCandidate = {
  id: string;
  userId: string | null;
  type: ParticipantType;
};

export type PublicationRecipient = {
  sessionParticipantId: string;
  userId: string;
  projection: AiAnalysisPublicationProjection;
};

/**
 * Maps room-connection identities to Participant/Observer publication
 * recipients. The helper itself does not inspect lease liveness: the caller
 * chooses the connection set.
 *
 * Publication authorization passes historical SessionRoomConnection rows,
 * including disconnected/superseded/revoked/expired connections. Canonical
 * current presence continues to use `activeHumanSessionConnectionWhere`.
 */
export function selectPublicationRecipients(
  roomConnections: RoomConnectionIdentity[],
  participants: SessionPublicationCandidate[],
): PublicationRecipient[] {
  const enteredUserIds = new Set(roomConnections.map((connection) => connection.userId));
  const recipients: PublicationRecipient[] = [];

  for (const participant of participants) {
    if (
      !participant.userId ||
      !enteredUserIds.has(participant.userId) ||
      (participant.type !== ParticipantType.PARTICIPANT &&
        participant.type !== ParticipantType.OBSERVER)
    ) {
      continue;
    }

    recipients.push({
      sessionParticipantId: participant.id,
      userId: participant.userId,
      projection:
        participant.type === ParticipantType.OBSERVER
          ? AiAnalysisPublicationProjection.OBSERVER
          : AiAnalysisPublicationProjection.PARTICIPANT,
    });
  }

  return recipients;
}

/**
 * Durable evidence that a user actually entered this Session room at least
 * once. Unlike `activeHumanSessionConnectionWhere`, terminal connections still
 * match.
 */
export function historicalSessionRoomEntryWhere(params: {
  sessionId: string;
  userId?: string;
}) {
  return {
    sessionId: params.sessionId,
    ...(params.userId ? { userId: params.userId } : {}),
    user: { status: "ACTIVE" as const },
  };
}

export function isGrantProjectionCompatibleWithParticipant(
  projection: AiAnalysisPublicationProjection,
  participantType: ParticipantType,
): boolean {
  if (projection === AiAnalysisPublicationProjection.OBSERVER) {
    return participantType === ParticipantType.OBSERVER;
  }
  return participantType === ParticipantType.PARTICIPANT;
}
