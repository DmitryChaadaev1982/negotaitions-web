import { ParticipantType } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { getEventLobbyUrl } from "@/lib/config";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { resolveDebriefVisibleNotes } from "@/lib/debrief-visible-notes";
import { prisma } from "@/lib/prisma";
import { summarizeLogicalPresenceByUser } from "@/lib/session-room-logical-presence";
import { sessionRoleBriefingSelect } from "@/lib/session-role";
import { getSessionMediaStatusMap } from "@/lib/voximplant/media-status-store";
import { isMediaStatusCurrentForConnection } from "@/lib/voximplant/reconnect-media-state";
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
      roomLabel: true,
      facilitatorId: true,
      visibility: true,
      roomLifecycle: true,
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

async function buildRoomSidebarData(
  participant: RoomSidebarParticipant | null,
): Promise<RoomSidebarData | null> {
  if (!participant) {
    return null;
  }

  const userIds = Array.from(
    new Set(
      participant.session.participants
        .map((entry) => entry.userId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const voximplantIdentityRows =
    userIds.length > 0
      ? await prisma.videoProviderIdentity.findMany({
          where: {
            provider: "voximplant",
            status: "active",
            userId: { in: userIds },
          },
          select: {
            userId: true,
            providerUsername: true,
          },
        })
      : [];
  const voximplantUsernameByUserId = new Map<string, string>();
  for (const row of voximplantIdentityRows) {
    if (!voximplantUsernameByUserId.has(row.userId)) {
      voximplantUsernameByUserId.set(row.userId, row.providerUsername);
    }
  }

  const logicalPresenceByUserId =
    userIds.length > 0
      ? summarizeLogicalPresenceByUser(
          await prisma.sessionRoomConnection.findMany({
            where: {
              sessionId: participant.sessionId,
              userId: { in: userIds },
            },
            select: {
              userId: true,
              connectionId: true,
              leaseVersion: true,
              disconnectedAt: true,
              disconnectedReason: true,
              supersededAt: true,
              revokedAt: true,
              expiresAt: true,
              updatedAt: true,
            },
          }),
        )
      : new Map();

  const currentParticipantEffectiveType = participant.type;
  const mediaStatusByParticipantId = await getSessionMediaStatusMap(participant.sessionId);

  const facilitatorBriefings =
    currentParticipantEffectiveType === ParticipantType.FACILITATOR
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
  const debriefNotes = resolveDebriefVisibleNotes({
    roomLifecycle: participant.session.roomLifecycle,
    viewerParticipantId: participant.id,
    viewerType: currentParticipantEffectiveType,
    participants: participant.session.participants.map((sessionParticipant) => ({
      id: sessionParticipant.id,
      userId: sessionParticipant.userId,
      displayName: sessionParticipant.displayName,
      type: sessionParticipant.type,
      notes: sessionParticipant.notes,
      updatedAt: sessionParticipant.updatedAt,
      sessionRole: sessionParticipant.sessionRole
        ? {
            name: sessionParticipant.sessionRole.name,
            sortOrder: sessionParticipant.sessionRole.sortOrder,
          }
        : null,
    })),
  });

  const roster = participant.session.participants.map((sessionParticipant) => {
    const logicalPresence = sessionParticipant.userId
      ? (logicalPresenceByUserId.get(sessionParticipant.userId) ?? null)
      : null;
    const activeConnectionId = logicalPresence?.activeConnectionId ?? null;
    const mediaStatus = mediaStatusByParticipantId[sessionParticipant.id] ?? null;
    const mediaStatusBelongsToActiveConnection = isMediaStatusCurrentForConnection(
      mediaStatus,
      activeConnectionId,
    );

    return {
      ...(logicalPresence
        ? {
            isLogicallyPresent: logicalPresence.isActive,
            logicalDisconnectReason: logicalPresence.inactiveReason,
            logicalConnectionId: logicalPresence.activeConnectionId,
          }
        : {}),
      ...(mediaStatusBelongsToActiveConnection
        ? {
            micEnabled: mediaStatus?.micEnabled ?? null,
            cameraEnabled: mediaStatus?.cameraEnabled ?? null,
            mediaStatusUpdatedAt: mediaStatus?.updatedAt ?? null,
          }
        : {}),
      id: sessionParticipant.id,
      displayName: sessionParticipant.displayName,
      participantType: sessionParticipant.type,
      caseRoleName: sessionParticipant.sessionRole?.name ?? null,
      userId: sessionParticipant.userId ?? null,
      voximplantProviderUsername: sessionParticipant.userId
        ? (voximplantUsernameByUserId.get(sessionParticipant.userId) ?? null)
        : null,
      joinedAt: sessionParticipant.joinedAt?.toISOString() ?? null,
      lastSeenAt: sessionParticipant.lastSeenAt?.toISOString() ?? null,
      // Phase 6.11B: expose sessionRoleId only; no private briefing data.
      sessionRoleId:
        sessionParticipant.type === ParticipantType.PARTICIPANT
          ? (sessionParticipant.sessionRoleId ?? null)
          : undefined,
    };
  });

  // Phase 6.11B: for facilitators, include assignable session roles for role management panel.
  const sessionRolesForFacilitator =
    currentParticipantEffectiveType === ParticipantType.FACILITATOR
      ? participant.session.sessionRoles
          .filter((r) => isAssignableCaseRole(r.name))
          .map((r) => ({ id: r.id, name: r.name }))
      : [];

  const isParticipantType =
    currentParticipantEffectiveType === ParticipantType.PARTICIPANT;
  // Phase 6.11B: unassigned PARTICIPANT has no sessionRole.
  const hasAssignedRole = !isParticipantType || participant.sessionRole !== null;

  return {
    sessionId: participant.sessionId,
    currentParticipantId: participant.id,
    sessionTitle: participant.session.title,
    roomLabel: participant.session.roomLabel,
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
                    currentParticipantEffectiveType === ParticipantType.FACILITATOR
                      ? participant.session.event.hostToken
                      : undefined,
                  participantToken: participant.eventParticipant?.participantToken,
                }),
        }
      : null,
    participantType: currentParticipantEffectiveType,
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
    debriefNotes,
    roster,
    sessionRolesForFacilitator,
  };
}
