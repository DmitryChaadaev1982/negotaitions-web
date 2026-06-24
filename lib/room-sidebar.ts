import { ParticipantType } from "@/app/generated/prisma/enums";
import { getEventLobbyUrl } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { sessionRoleBriefingSelect } from "@/lib/session-role";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";

export type { RoomSidebarData } from "@/lib/room-sidebar-types";

export async function getRoomSidebarData(
  joinToken: string,
): Promise<RoomSidebarData | null> {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: {
      sessionRole: {
        select: sessionRoleBriefingSelect,
      },
      eventParticipant: {
        select: {
          participantToken: true,
        },
      },
      session: {
        select: {
          title: true,
          durationSeconds: true,
          snapshotBusinessContext: true,
          snapshotPublicInstructions: true,
          snapshotCaseLanguage: true,
          event: {
            select: {
              id: true,
              title: true,
              status: true,
              hostToken: true,
            },
          },
          participants: {
            include: {
              sessionRole: {
                select: sessionRoleBriefingSelect,
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!participant) {
    return null;
  }

  const facilitatorBriefings =
    participant.type === ParticipantType.FACILITATOR
      ? participant.session.participants
          .filter(
            (sessionParticipant) =>
              sessionParticipant.type === ParticipantType.PARTICIPANT &&
              sessionParticipant.sessionRole,
          )
          .map((sessionParticipant) => ({
            displayName: sessionParticipant.displayName,
            role: sessionParticipant.sessionRole!,
          }))
      : [];

  const roster = participant.session.participants.map((sessionParticipant) => ({
    id: sessionParticipant.id,
    displayName: sessionParticipant.displayName,
    participantType: sessionParticipant.type,
    caseRoleName: sessionParticipant.sessionRole?.name ?? null,
  }));

  return {
    sessionTitle: participant.session.title,
    event: participant.session.event
      ? {
          id: participant.session.event.id,
          title: participant.session.event.title,
          status: participant.session.event.status,
          lobbyUrl: getEventLobbyUrl(participant.session.event.id, {
            hostToken:
              participant.type === ParticipantType.FACILITATOR
                ? participant.session.event.hostToken
                : undefined,
            participantToken: participant.eventParticipant?.participantToken,
          }),
        }
      : null,
    participantType: participant.type,
    displayName: participant.displayName,
    notes: participant.notes,
    durationSeconds: participant.session.durationSeconds,
    publicContext: {
      description: participant.session.snapshotBusinessContext,
      publicInstructions: participant.session.snapshotPublicInstructions,
      caseLanguage: participant.session.snapshotCaseLanguage,
    },
    caseRole: participant.sessionRole,
    facilitatorBriefings,
    roster,
  };
}
