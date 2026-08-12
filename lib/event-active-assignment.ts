import {
  NegotiationState,
  type Prisma,
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSessionActiveForRoom } from "@/lib/session-overview-shared";

export const ACTIVE_SESSION_ASSIGNMENT_SESSION_WHERE = {
  deletedAt: null,
  closedByEventAt: null,
  NOT: [
    {
      status: SessionStatus.COMPLETED,
      roomLifecycle: RoomLifecycle.CLOSED,
    },
    {
      status: SessionStatus.COMPLETED,
      roomLifecycle: null,
      negotiationState: NegotiationState.FINISHED,
    },
  ],
} satisfies Prisma.SessionWhereInput;

export async function getActiveSessionAssignment(
  eventParticipantId: string,
  eventId: string,
) {
  const assignments = await prisma.sessionParticipant.findMany({
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
          status: true,
          negotiationState: true,
          roomLifecycle: true,
          closedByEventAt: true,
          deletedAt: true,
          event: {
            select: {
              status: true,
            },
          },
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

  return (
    assignments.find((assignment) =>
      isSessionActiveForAssignment(assignment.session),
    ) ?? null
  );
}

export function isSessionActiveForAssignment(session: {
  deletedAt?: Date | null;
  closedByEventAt?: Date | null;
  negotiationState: NegotiationState | string;
  status: SessionStatus;
  roomLifecycle: RoomLifecycle | null;
  event?: {
    status?: string | null;
  } | null;
}) {
  return isSessionActiveForRoom({
    ...session,
    closedByEventAt: session.closedByEventAt ?? null,
  });
}
