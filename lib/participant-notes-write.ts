import { ParticipantType } from "@/app/generated/prisma/client";

import { areMaterialNegotiationNotesLockedAfterNegotiation } from "@/lib/ai/material-negotiation-notes";
import { prisma } from "@/lib/prisma";

export type ParticipantNotesWriteDenial =
  | "NOT_FOUND"
  | "SESSION_DELETED"
  | "PREPARATION_LOCKED_NO_ROLE"
  | "PREPARATION_LOCKED_AFTER_NEGOTIATION";

export type ParticipantNotesWriteResult =
  | { ok: true; notes: string }
  | { ok: false; denial: ParticipantNotesWriteDenial };

/**
 * Persist notes after the caller has already authorized the participant.
 * Enforces the role-aware post-negotiation material-notes lock.
 */
export async function persistParticipantNotesAfterAccess(input: {
  participantId: string;
  notes: string;
  enforceUnassignedParticipantLock: boolean;
}): Promise<ParticipantNotesWriteResult> {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: input.participantId },
    select: {
      id: true,
      type: true,
      sessionRoleId: true,
      session: {
        select: {
          deletedAt: true,
          negotiationState: true,
        },
      },
    },
  });

  if (!participant) {
    return { ok: false, denial: "NOT_FOUND" };
  }

  if (participant.session.deletedAt) {
    return { ok: false, denial: "SESSION_DELETED" };
  }

  if (
    input.enforceUnassignedParticipantLock &&
    participant.type === ParticipantType.PARTICIPANT &&
    !participant.sessionRoleId
  ) {
    return { ok: false, denial: "PREPARATION_LOCKED_NO_ROLE" };
  }

  if (
    areMaterialNegotiationNotesLockedAfterNegotiation({
      participantType: participant.type,
      negotiationState: participant.session.negotiationState,
    })
  ) {
    return { ok: false, denial: "PREPARATION_LOCKED_AFTER_NEGOTIATION" };
  }

  if (participant.type === ParticipantType.PARTICIPANT) {
    const mutation = await prisma.sessionParticipant.updateMany({
      where: {
        id: input.participantId,
        type: ParticipantType.PARTICIPANT,
        session: {
          deletedAt: null,
          negotiationState: { not: "FINISHED" },
        },
      },
      data: { notes: input.notes },
    });
    if (mutation.count !== 1) {
      return { ok: false, denial: "PREPARATION_LOCKED_AFTER_NEGOTIATION" };
    }
  } else {
    await prisma.sessionParticipant.update({
      where: { id: input.participantId },
      data: { notes: input.notes },
    });
  }

  return { ok: true, notes: input.notes };
}
