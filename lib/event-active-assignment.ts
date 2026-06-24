import { NegotiationState, SessionStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const ACTIVE_SESSION_ASSIGNMENT_SESSION_WHERE = {
  deletedAt: null,
  closedByEventAt: null,
  negotiationState: { not: NegotiationState.FINISHED },
  status: { not: SessionStatus.COMPLETED },
} as const;

export async function getActiveSessionAssignment(
  eventParticipantId: string,
  eventId: string,
) {
  return prisma.sessionParticipant.findFirst({
    where: {
      eventParticipantId,
      session: {
        eventId,
        ...ACTIVE_SESSION_ASSIGNMENT_SESSION_WHERE,
      },
    },
    include: {
      session: {
        select: {
          id: true,
          title: true,
          roomLabel: true,
          sequenceNumber: true,
          negotiationState: true,
        },
      },
      sessionRole: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export function isSessionActiveForAssignment(session: {
  deletedAt?: Date | null;
  closedByEventAt?: Date | null;
  negotiationState: NegotiationState | string;
  status?: SessionStatus | string;
}) {
  return (
    !session.deletedAt &&
    !session.closedByEventAt &&
    session.negotiationState !== NegotiationState.FINISHED &&
    session.status !== SessionStatus.COMPLETED
  );
}
