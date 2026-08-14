import { ParticipantType } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { isAssignableCaseRole } from "@/lib/case-roles";
import {
  lockSessionParticipantsForSession,
  orderSessionParticipantIds,
} from "@/lib/session-participant-locking";

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
  void participants;
  void sessionFacilitatorUserId;
  // Never silently rewrite facilitator rows at read time.
  // Facilitator changes must go through the explicit reassignment service.
  return participant.type;
}

export type FacilitatorFallbackType = "PARTICIPANT" | "OBSERVER";

export type ReassignSessionFacilitatorParams = {
  sessionId: string;
  nextFacilitatorParticipantId: string;
  previousFacilitatorType: FacilitatorFallbackType;
  previousFacilitatorSessionRoleId?: string | null;
};

export type ReassignSessionFacilitatorResult =
  | {
      ok: true;
      changed: boolean;
      facilitatorParticipantId: string;
      facilitatorUserId: string;
      previousFacilitatorParticipantId: string | null;
    }
  | {
      ok: false;
      error:
        | "sessionNotFound"
        | "participantNotFound"
        | "participantMustBeAccountBound"
        | "ambiguousFacilitatorState"
        | "invalidPreviousFacilitatorRole"
        | "previousFacilitatorRoleConflict"
        | "previousFacilitatorRoleNotAssignable";
    };

export async function reassignSessionFacilitator(
  params: ReassignSessionFacilitatorParams,
): Promise<ReassignSessionFacilitatorResult> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({
      where: { id: params.sessionId },
      select: { id: true, facilitatorId: true, deletedAt: true },
    });
    if (!session || session.deletedAt) {
      return { ok: false, error: "sessionNotFound" };
    }

    await lockSessionParticipantsForSession(tx, params.sessionId);
    const participants = await tx.sessionParticipant.findMany({
      where: { sessionId: params.sessionId },
      select: {
        id: true,
        userId: true,
        type: true,
        sessionRoleId: true,
        createdAt: true,
      },
    });

    const nextFacilitator = participants.find(
      (participant) => participant.id === params.nextFacilitatorParticipantId,
    );
    if (!nextFacilitator) {
      return { ok: false, error: "participantNotFound" };
    }
    if (!nextFacilitator.userId) {
      return { ok: false, error: "participantMustBeAccountBound" };
    }

    const canonicalFacilitatorParticipantId =
      resolveCanonicalFacilitatorParticipantId(
        participants,
        session.facilitatorId,
      );
    const canonicalFacilitator = canonicalFacilitatorParticipantId
      ? participants.find(
          (participant) => participant.id === canonicalFacilitatorParticipantId,
        ) ?? null
      : null;

    const additionalFacilitators = participants.filter(
      (participant) =>
        participant.type === ParticipantType.FACILITATOR &&
        participant.id !== nextFacilitator.id &&
        participant.id !== canonicalFacilitator?.id,
    );
    if (additionalFacilitators.length > 0) {
      return { ok: false, error: "ambiguousFacilitatorState" };
    }

    const sameFacilitator =
      canonicalFacilitator?.id === nextFacilitator.id &&
      session.facilitatorId === nextFacilitator.userId;
    if (sameFacilitator) {
      return {
        ok: true,
        changed: false,
        facilitatorParticipantId: nextFacilitator.id,
        facilitatorUserId: nextFacilitator.userId,
        previousFacilitatorParticipantId: canonicalFacilitator?.id ?? null,
      };
    }

    if (params.previousFacilitatorType === "OBSERVER") {
      if (params.previousFacilitatorSessionRoleId) {
        return { ok: false, error: "invalidPreviousFacilitatorRole" };
      }
    } else if (params.previousFacilitatorSessionRoleId) {
      const selectedRole = await tx.sessionRole.findFirst({
        where: {
          id: params.previousFacilitatorSessionRoleId,
          sessionId: params.sessionId,
        },
        select: { id: true, name: true },
      });
      if (!selectedRole) {
        return { ok: false, error: "invalidPreviousFacilitatorRole" };
      }
      if (!isAssignableCaseRole(selectedRole.name)) {
        return { ok: false, error: "previousFacilitatorRoleNotAssignable" };
      }
      const conflictingParticipant = await tx.sessionParticipant.findFirst({
        where: {
          sessionId: params.sessionId,
          type: ParticipantType.PARTICIPANT,
          sessionRoleId: selectedRole.id,
          id: {
            notIn: [
              canonicalFacilitator?.id ?? "",
              nextFacilitator.id,
            ],
          },
        },
        select: { id: true },
      });
      if (conflictingParticipant) {
        return { ok: false, error: "previousFacilitatorRoleConflict" };
      }
    }

    await tx.session.update({
      where: { id: params.sessionId },
      data: { facilitatorId: nextFacilitator.userId },
    });

    const participantUpdates = new Map<
      string,
      {
        type: ParticipantType;
        sessionRoleId: string | null;
      }
    >([
      [
        nextFacilitator.id,
        {
          type: ParticipantType.FACILITATOR,
          sessionRoleId: null,
        },
      ],
    ]);
    if (canonicalFacilitator && canonicalFacilitator.id !== nextFacilitator.id) {
      participantUpdates.set(canonicalFacilitator.id, {
        type:
          params.previousFacilitatorType === "PARTICIPANT"
            ? ParticipantType.PARTICIPANT
            : ParticipantType.OBSERVER,
        sessionRoleId:
          params.previousFacilitatorType === "PARTICIPANT"
            ? (params.previousFacilitatorSessionRoleId ?? null)
            : null,
      });
    }
    for (const participantId of orderSessionParticipantIds(
      [...participantUpdates.keys()],
    )) {
      await tx.sessionParticipant.update({
        where: { id: participantId },
        data: participantUpdates.get(participantId)!,
      });
    }

    const now = new Date();
    const activeConnectionWhere = {
      sessionId: params.sessionId,
      disconnectedAt: null,
      supersededAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    } as const;

    // A room connection lease snapshots the participant role at claim time.
    // Keep already-open clients aligned with the participant-role mutation so
    // strict facilitator control remains authoritative without requiring a
    // hidden refresh/rejoin step.
    await tx.sessionRoomConnection.updateMany({
      where: {
        ...activeConnectionWhere,
        userId: nextFacilitator.userId,
      },
      data: { role: ParticipantType.FACILITATOR },
    });

    if (
      canonicalFacilitator?.userId &&
      canonicalFacilitator.userId !== nextFacilitator.userId
    ) {
      await tx.sessionRoomConnection.updateMany({
        where: {
          ...activeConnectionWhere,
          userId: canonicalFacilitator.userId,
        },
        data: {
          role:
            params.previousFacilitatorType === "PARTICIPANT"
              ? ParticipantType.PARTICIPANT
              : ParticipantType.OBSERVER,
        },
      });
    }

    return {
      ok: true,
      changed: true,
      facilitatorParticipantId: nextFacilitator.id,
      facilitatorUserId: nextFacilitator.userId,
      previousFacilitatorParticipantId: canonicalFacilitator?.id ?? null,
    };
  });
}
