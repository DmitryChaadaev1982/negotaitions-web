import { ParticipantType } from "@/app/generated/prisma/enums";

type FacilitatorCandidate = {
  id: string;
  type: ParticipantType;
  userId: string | null;
  createdAt: Date;
};

/**
 * Returns the canonical facilitator participant id for a session.
 *
 * Priority:
 * 1) explicit session owner row (`session.facilitatorId`) with FACILITATOR type;
 * 2) earliest FACILITATOR row;
 * 3) explicit session owner row of any type;
 * 4) null (no reliable facilitator row yet).
 */
export function resolveCanonicalFacilitatorParticipantId(
  participants: FacilitatorCandidate[],
  sessionFacilitatorUserId: string | null,
): string | null {
  const sorted = [...participants].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  if (sessionFacilitatorUserId) {
    const ownerFacilitator = sorted.find(
      (entry) =>
        entry.userId === sessionFacilitatorUserId &&
        entry.type === ParticipantType.FACILITATOR,
    );
    if (ownerFacilitator) {
      return ownerFacilitator.id;
    }
  }

  const earliestFacilitator = sorted.find(
    (entry) => entry.type === ParticipantType.FACILITATOR,
  );
  if (earliestFacilitator) {
    return earliestFacilitator.id;
  }

  if (sessionFacilitatorUserId) {
    const ownerAnyType = sorted.find(
      (entry) => entry.userId === sessionFacilitatorUserId,
    );
    if (ownerAnyType) {
      return ownerAnyType.id;
    }
  }

  return null;
}

export function resolveSessionParticipantType(
  participant: { id: string; type: ParticipantType },
  participants: FacilitatorCandidate[],
  sessionFacilitatorUserId: string | null,
): ParticipantType {
  if (participant.type !== ParticipantType.FACILITATOR) {
    return participant.type;
  }

  const canonicalFacilitatorId = resolveCanonicalFacilitatorParticipantId(
    participants,
    sessionFacilitatorUserId,
  );
  if (!canonicalFacilitatorId) {
    return participant.type;
  }

  return participant.id === canonicalFacilitatorId
    ? ParticipantType.FACILITATOR
    : ParticipantType.OBSERVER;
}
