import type { AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { scopeAssignedParticipantsForObserver } from "@/lib/privacy/serializers";

export type ObserverSessionMaterialsData = {
  sessionId: string;
  title: string;
  roomLabel: string | null;
  caseTitle: string;
  caseLanguage: string;
  status: string;
  negotiationState: string;
  roomLifecycle: string | null;
  businessContext: string;
  publicInstructions: string;
  event: {
    id: string;
    title: string;
    status: string;
    lobbyUrl: string;
  };
  assignedParticipants: Array<{
    id: string;
    displayName: string;
    roleName: string;
  }>;
};

export async function getObserverSessionMaterialsData(
  sessionId: string,
  user: AuthUser,
): Promise<ObserverSessionMaterialsData | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      eventId: true,
      deletedAt: true,
      title: true,
      roomLabel: true,
      snapshotCaseTitle: true,
      snapshotCaseLanguage: true,
      status: true,
      negotiationState: true,
      roomLifecycle: true,
      snapshotBusinessContext: true,
      snapshotPublicInstructions: true,
      event: {
        select: {
          id: true,
          title: true,
          status: true,
          hostUserId: true,
          facilitatorUserId: true,
        },
      },
      participants: {
        select: {
          id: true,
          displayName: true,
          type: true,
          sessionRole: {
            select: {
              name: true,
              privateInstructions: true,
              objectives: true,
              constraints: true,
              hiddenInfo: true,
              fallbackPosition: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session || session.deletedAt || !session.eventId || !session.event) {
    return null;
  }

  const hasDirectEventMembership = Boolean(
    isAdmin(user) ||
      session.event.hostUserId === user.id ||
      session.event.facilitatorUserId === user.id ||
      (await prisma.eventParticipant.findFirst({
        where: {
          eventId: session.eventId,
          userId: user.id,
        },
        select: { id: true },
      })),
  );
  if (!hasDirectEventMembership) {
    return null;
  }

  const isCompletedSemantic =
    session.status === "COMPLETED" ||
    session.negotiationState === "FINISHED" ||
    session.roomLifecycle === "DEBRIEF_OPEN" ||
    session.roomLifecycle === "CLOSED";
  if (!isCompletedSemantic) {
    return null;
  }

  const scopedAssigned = scopeAssignedParticipantsForObserver(
    session.participants.map((participant) => ({
      id: participant.id,
      displayName: participant.displayName,
      type: participant.type as string,
      sessionRole: participant.sessionRole,
    })),
  );

  return {
    sessionId: session.id,
    title: session.title,
    roomLabel: session.roomLabel,
    caseTitle: session.snapshotCaseTitle,
    caseLanguage: session.snapshotCaseLanguage,
    status: session.status,
    negotiationState: session.negotiationState,
    roomLifecycle: session.roomLifecycle,
    businessContext: session.snapshotBusinessContext,
    publicInstructions: session.snapshotPublicInstructions,
    event: {
      id: session.event.id,
      title: session.event.title,
      status: session.event.status,
      lobbyUrl: `/events/${session.event.id}/lobby`,
    },
    assignedParticipants: scopedAssigned
      .filter((participant) => participant.role.name.trim().length > 0)
      .map((participant) => ({
        id: participant.id,
        displayName: participant.displayName,
        roleName: participant.role.name,
      })),
  };
}
