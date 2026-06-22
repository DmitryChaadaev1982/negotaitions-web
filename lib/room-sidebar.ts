import { ParticipantType } from "@/app/generated/prisma/enums";
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
      session: {
        select: {
          title: true,
          durationSeconds: true,
          snapshotBusinessContext: true,
          snapshotPublicInstructions: true,
          snapshotCaseLanguage: true,
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

  const facilitatorBriefings = participant.session.participants
    .filter(
      (sessionParticipant) =>
        sessionParticipant.type === ParticipantType.PARTICIPANT &&
        sessionParticipant.sessionRole,
    )
    .map((sessionParticipant) => ({
      displayName: sessionParticipant.displayName,
      role: sessionParticipant.sessionRole!,
    }));

  const roster = participant.session.participants.map((sessionParticipant) => ({
    id: sessionParticipant.id,
    displayName: sessionParticipant.displayName,
    participantType: sessionParticipant.type,
    caseRoleName: sessionParticipant.sessionRole?.name ?? null,
  }));

  return {
    sessionTitle: participant.session.title,
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
