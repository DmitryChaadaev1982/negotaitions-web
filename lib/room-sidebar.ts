import { ParticipantType } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";

export type { RoomSidebarData } from "@/lib/room-sidebar-types";

const roleBriefingSelect = {
  name: true,
  privateInstructions: true,
  objectives: true,
  constraints: true,
  hiddenInfo: true,
  fallbackPosition: true,
} as const;

export async function getRoomSidebarData(
  joinToken: string,
): Promise<RoomSidebarData | null> {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: {
      caseRole: {
        select: roleBriefingSelect,
      },
      session: {
        select: {
          title: true,
          durationSeconds: true,
          negotiationCase: {
            select: {
              defaultDurationSeconds: true,
            },
          },
          participants: {
            include: {
              caseRole: {
                select: roleBriefingSelect,
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

  const facilitatorBriefings = participant.session.participants
    .filter(
      (sessionParticipant) =>
        sessionParticipant.type === ParticipantType.PARTICIPANT &&
        sessionParticipant.caseRole,
    )
    .map((sessionParticipant) => ({
      displayName: sessionParticipant.displayName,
      role: sessionParticipant.caseRole!,
    }));

  const roster = participant.session.participants.map((sessionParticipant) => ({
    id: sessionParticipant.id,
    displayName: sessionParticipant.displayName,
    participantType: sessionParticipant.type,
    caseRoleName: sessionParticipant.caseRole?.name ?? null,
  }));

  return {
    sessionTitle: participant.session.title,
    participantType: participant.type,
    displayName: participant.displayName,
    notes: participant.notes,
    durationSeconds: participant.session.durationSeconds,
    caseRole: participant.caseRole,
    facilitatorBriefings,
    roster,
  };
}
