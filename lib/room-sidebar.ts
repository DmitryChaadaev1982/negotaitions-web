import { ParticipantType } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { getEventLobbyUrl } from "@/lib/config";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { prisma } from "@/lib/prisma";
import { sessionRoleBriefingSelect } from "@/lib/session-role";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";

export type { RoomSidebarData } from "@/lib/room-sidebar-types";

const roomSidebarParticipantInclude = {
  sessionRole: {
    select: sessionRoleBriefingSelect,
  },
  eventParticipant: {
    select: {
      participantToken: true,
      userId: true,
    },
  },
  session: {
    select: {
      title: true,
      visibility: true,
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
        orderBy: { createdAt: "asc" as const },
      },
      // Phase 6.11B: session roles for facilitator role management panel.
      sessionRoles: {
        select: { id: true, name: true },
        orderBy: { sortOrder: "asc" as const },
      },
    },
  },
} satisfies Prisma.SessionParticipantInclude;

type RoomSidebarParticipant = Prisma.SessionParticipantGetPayload<{
  include: typeof roomSidebarParticipantInclude;
}>;

export async function getRoomSidebarData(
  joinToken: string,
): Promise<RoomSidebarData | null> {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: roomSidebarParticipantInclude,
  });

  return buildRoomSidebarData(participant);
}

export async function getRoomSidebarDataByParticipantId(
  participantId: string,
): Promise<RoomSidebarData | null> {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId },
    include: roomSidebarParticipantInclude,
  });

  return buildRoomSidebarData(participant);
}

function buildRoomSidebarData(
  participant: RoomSidebarParticipant | null,
): RoomSidebarData | null {
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
    // Phase 6.11B: expose sessionRoleId only; no private briefing data.
    sessionRoleId: sessionParticipant.type === ParticipantType.PARTICIPANT
      ? (sessionParticipant.sessionRoleId ?? null)
      : undefined,
  }));

  // Phase 6.11B: for facilitators, include assignable session roles for role management panel.
  const sessionRolesForFacilitator =
    participant.type === ParticipantType.FACILITATOR
      ? participant.session.sessionRoles
          .filter((r) => isAssignableCaseRole(r.name))
          .map((r) => ({ id: r.id, name: r.name }))
      : [];

  const isParticipantType = participant.type === ParticipantType.PARTICIPANT;
  // Phase 6.11B: unassigned PARTICIPANT has no sessionRole.
  const hasAssignedRole = !isParticipantType || participant.sessionRole !== null;

  return {
    sessionId: participant.sessionId,
    sessionTitle: participant.session.title,
    visibility: participant.session.visibility,
    event: participant.session.event
      ? {
          id: participant.session.event.id,
          title: participant.session.event.title,
          status: participant.session.event.status,
          lobbyUrl:
            participant.userId || participant.eventParticipant?.userId
              ? `/events/${participant.session.event.id}/lobby`
              : getEventLobbyUrl(participant.session.event.id, {
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
    caseRole: hasAssignedRole ? participant.sessionRole : null,
    hasAssignedRole,
    facilitatorBriefings,
    roster,
    sessionRolesForFacilitator,
  };
}
