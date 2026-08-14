import {
  AiAnalysisPublicationProjection,
  ParticipantType,
} from "@/app/generated/prisma/client";

type ActiveRoomConnection = {
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
 * Converts a canonical active-lease snapshot into the durable publication
 * recipients. The caller is responsible for querying active leases with the
 * canonical lease predicate at one publication timestamp.
 */
export function selectPublicationRecipients(
  activeConnections: ActiveRoomConnection[],
  participants: SessionPublicationCandidate[],
): PublicationRecipient[] {
  const activeUserIds = new Set(activeConnections.map((connection) => connection.userId));
  const recipients: PublicationRecipient[] = [];

  for (const participant of participants) {
    if (
      !participant.userId ||
      !activeUserIds.has(participant.userId) ||
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

export function isGrantProjectionCompatibleWithParticipant(
  projection: AiAnalysisPublicationProjection,
  participantType: ParticipantType,
): boolean {
  if (projection === AiAnalysisPublicationProjection.OBSERVER) {
    return participantType === ParticipantType.OBSERVER;
  }
  return participantType === ParticipantType.PARTICIPANT;
}
