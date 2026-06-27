import type {
  EventParticipant,
  ParticipantType,
  SessionParticipant,
  TrainingEvent,
} from "@/app/generated/prisma/client";
import {
  buildAccountSessionMaterialsPath,
  buildAccountSessionRoomPath,
  buildSessionMaterialsPath,
  buildSessionRoomPath,
} from "@/lib/config";
import {
  isSessionActiveForAssignment,
} from "@/lib/event-active-assignment";
import {
  parseAssignmentDraft,
  type EventAssignmentDraft,
} from "@/lib/event-assignment";
import { caseVisibilityWhereForUser } from "@/lib/case-access";
import { toPublicCaseSummary, type PublicCaseSummary } from "@/lib/event-case-public";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { resolveConnectionStatusForLobby } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";

export type EventStateParticipant = {
  id: string;
  displayName: string;
  email: string | null;
  isHost: boolean;
  preference: string;
  wantsToPlay: boolean;
  wantsToObserve: boolean;
  wantsToFacilitate: boolean;
  joinedAt: string | null;
  lastSeenAt: string | null;
  connectionStatus: "ONLINE" | "RECENTLY_DISCONNECTED" | "OFFLINE";
  assignedSessionId: string | null;
  assignedSessionParticipantId: string | null;
  assignedType: string | null;
  assignedRoleName: string | null;
  joinToken?: string | null;
  roomUrl: string | null;
  materialsUrl: string | null;
  activeAssignmentLabel: string | null;
};

export type EventStateSession = {
  id: string;
  title: string;
  roomLabel: string | null;
  sequenceNumber: number | null;
  caseTitle: string;
  caseLanguage: string;
  status: string;
  negotiationState: string;
  preparationDuration: number;
  negotiationDuration: number;
  participantCount: number;
  observerCount: number;
  facilitatorName: string | null;
  isActive: boolean;
  isFinished: boolean;
  roomUrl: string | null;
  materialsUrl: string | null;
  createdAt: string;
  recordingStatus: string | null;
  closeReason: string | null;
  closedByEventAt: string | null;
  participants: Array<{
    id: string;
    eventParticipantId: string | null;
    displayName: string;
    participantType: ParticipantType;
    roleName: string | null;
    roomUrl: string | null;
    materialsUrl: string | null;
  }>;
};

export type EventStateResponse = {
  event: {
    id: string;
    title: string;
    description: string | null;
    scheduledAt: string | null;
    status: string;
    visibility: "PUBLIC" | "PRIVATE";
    completedAt: string | null;
    completionReason: string | null;
    estimatedEventDurationSeconds: number | null;
    estimatedEventDurationMinutes: number | null;
    lobbyRoomName: string | null;
    publicJoinCode: string;
  };
  currentParticipant: {
    id: string;
    displayName: string;
    preference: string;
  } | null;
  isHost: boolean;
  /**
   * true only when the authenticated user is the designated host/facilitator
   * of this event, or has a valid hostToken. false for system admins who are
   * not the event owner. Use this to gate host-controls UI in the lobby.
   */
  isEventOwner: boolean;
  participants: EventStateParticipant[];
  sessions: EventStateSession[];
  availableParticipants: EventStateParticipant[];
  selectedCase: PublicCaseSummary | null;
  availableCases: PublicCaseSummary[];
  assignmentDraft: EventAssignmentDraft;
  createdSession: {
    id: string;
    title: string;
  } | null;
  linkedSessions: Array<{
    id: string;
    title: string;
    roomLabel: string | null;
    sequenceNumber: number | null;
    negotiationState: string;
    closeReason: string | null;
    closedByEventAt: string | null;
  }>;
};

type BuildEventStateInput = {
  event: TrainingEvent;
  isHost: boolean;
  /** true only for designated host/facilitator/hostToken — not plain admins. Gates host-controls UI. */
  isEventOwner?: boolean;
  isAdmin?: boolean;
  currentParticipant: EventParticipant | null;
  accountMode?: boolean;
  /** ID of the authenticated user making this request. Used to resolve case library when event has no hostUserId. */
  userId?: string | null;
};

function getAssignmentDurationDefaults(
  selectedCase: {
    defaultPreparationDurationSeconds: number;
    defaultDurationSeconds: number;
  } | null,
) {
  if (selectedCase) {
    return {
      preparationDurationMinutes: secondsToDisplayMinutes(
        selectedCase.defaultPreparationDurationSeconds,
      ),
      negotiationDurationMinutes: secondsToDisplayMinutes(
        selectedCase.defaultDurationSeconds,
      ),
    };
  }

  return {
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };
}

export async function buildEventState(
  input: BuildEventStateInput,
): Promise<EventStateResponse> {
  const ownerUserId =
    input.event.hostUserId ?? input.event.facilitatorUserId ?? input.userId ?? null;
  const caseScopeWhere = input.isAdmin
    ? {}
    : ownerUserId
      ? caseVisibilityWhereForUser(ownerUserId)
      : { visibility: "PUBLIC" as const };

  const [participants, cases, selectedCaseRecord, createdSession, linkedSessions, sessionParticipantAssignments] =
    await Promise.all([
      prisma.eventParticipant.findMany({
        where: { eventId: input.event.id },
        orderBy: { createdAt: "asc" },
      }),
      prisma.negotiationCase.findMany({
        where: {
          ...activeCaseWhere,
          ...caseScopeWhere,
        },
        include: {
          roles: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true, sortOrder: true },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      }),
      input.event.selectedCaseId
        ? prisma.negotiationCase.findFirst({
            where: {
              id: input.event.selectedCaseId,
              ...activeCaseWhere,
              ...caseScopeWhere,
            },
            include: {
              roles: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, name: true, sortOrder: true },
              },
            },
          })
        : Promise.resolve(null),
      prisma.session.findFirst({
        where: { eventId: input.event.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true },
      }),
      prisma.session.findMany({
        where: { eventId: input.event.id, deletedAt: null },
        orderBy: [{ sequenceNumber: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          roomLabel: true,
          sequenceNumber: true,
          snapshotCaseTitle: true,
          snapshotCaseLanguage: true,
          status: true,
          negotiationState: true,
          preparationDurationSeconds: true,
          durationSeconds: true,
          createdAt: true,
          closeReason: true,
          closedByEventAt: true,
          deletedAt: true,
          recording: {
            select: { status: true },
          },
          participants: {
            orderBy: { createdAt: "asc" },
            include: {
              sessionRole: { select: { name: true } },
            },
          },
        },
      }),
      prisma.sessionParticipant.findMany({
        where: {
          eventParticipantId: { not: null },
          eventParticipant: { eventId: input.event.id },
        },
        include: {
          sessionRole: { select: { name: true } },
          session: {
            select: {
              id: true,
              title: true,
              roomLabel: true,
              sequenceNumber: true,
              negotiationState: true,
              status: true,
              deletedAt: true,
              closedByEventAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const assignmentDraft = parseAssignmentDraft(
    input.event.assignmentDraft,
    getAssignmentDurationDefaults(selectedCaseRecord),
  );
  const activeAssignmentsByEventParticipantId = new Map<
    string,
    (typeof sessionParticipantAssignments)[number]
  >();

  for (const assignment of sessionParticipantAssignments) {
    if (
      assignment.eventParticipantId &&
      isSessionActiveForAssignment(assignment.session) &&
      !activeAssignmentsByEventParticipantId.has(assignment.eventParticipantId)
    ) {
      activeAssignmentsByEventParticipantId.set(
        assignment.eventParticipantId,
        assignment,
      );
    }
  }

  const currentParticipantId = input.currentParticipant?.id ?? null;
  const mappedParticipants = participants.map((participant) =>
    mapEventParticipant({
      participant,
      activeAssignment:
        activeAssignmentsByEventParticipantId.get(participant.id) ?? null,
      isHost: input.isHost,
      currentParticipantId,
      accountMode: Boolean(input.accountMode),
    }),
  );
  const sessions = linkedSessions.map((session) =>
    mapEventSession({
      session,
      isHost: input.isHost,
      currentParticipantId,
      accountMode: Boolean(input.accountMode),
    }),
  );

  return {
    event: {
      id: input.event.id,
      title: input.event.title,
      description: input.event.description,
      scheduledAt: input.event.scheduledAt?.toISOString() ?? null,
      status: input.event.status,
      visibility: input.event.visibility,
      completedAt: input.event.completedAt?.toISOString() ?? null,
      completionReason: input.event.completionReason,
      estimatedEventDurationSeconds: input.event.estimatedEventDurationSeconds,
      estimatedEventDurationMinutes: input.event.estimatedEventDurationSeconds
        ? secondsToDisplayMinutes(input.event.estimatedEventDurationSeconds)
        : null,
      lobbyRoomName: input.event.lobbyRoomName,
      publicJoinCode: input.event.publicJoinCode,
    },
    currentParticipant: input.currentParticipant
      ? {
          id: input.currentParticipant.id,
          displayName: input.currentParticipant.displayName,
          preference: input.currentParticipant.preference,
        }
      : null,
    isHost: input.isHost,
    isEventOwner: input.isEventOwner ?? input.isHost,
    participants: mappedParticipants,
    sessions,
    availableParticipants: mappedParticipants.filter(
      (participant) => !participant.assignedSessionId,
    ),
    selectedCase: selectedCaseRecord
      ? toPublicCaseSummary(selectedCaseRecord)
      : null,
    availableCases: input.isHost ? cases.map(toPublicCaseSummary) : [],
    assignmentDraft,
    createdSession: createdSession
      ? { id: createdSession.id, title: createdSession.title }
      : null,
    linkedSessions: linkedSessions.map((session) => ({
      id: session.id,
      title: session.title,
      roomLabel: session.roomLabel,
      sequenceNumber: session.sequenceNumber,
      negotiationState: session.negotiationState,
      closeReason: session.closeReason,
      closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
    })),
  };
}

function mapEventParticipant({
  participant,
  activeAssignment,
  isHost,
  currentParticipantId,
  accountMode,
}: {
  participant: EventParticipant;
  activeAssignment:
    | (SessionParticipant & {
        sessionRole: { name: string } | null;
        session: {
          id: string;
          title: string;
          roomLabel: string | null;
          sequenceNumber: number | null;
        };
      })
    | null;
  isHost: boolean;
  currentParticipantId: string | null;
  accountMode: boolean;
}): EventStateParticipant {
  const canSeeJoinToken = !accountMode && (isHost || participant.id === currentParticipantId);
  const assignmentLabel = activeAssignment?.session.roomLabel
    ?? activeAssignment?.session.title
    ?? null;

  return {
    id: participant.id,
    displayName: participant.displayName,
    email: participant.email,
    isHost: participant.isHost,
    preference: participant.preference,
    wantsToPlay: participant.wantsToPlay,
    wantsToObserve: participant.wantsToObserve,
    wantsToFacilitate: participant.wantsToFacilitate,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    connectionStatus: resolveConnectionStatusForLobby(participant.lastSeenAt),
    assignedSessionId: activeAssignment?.sessionId ?? null,
    assignedSessionParticipantId: activeAssignment?.id ?? null,
    assignedType: activeAssignment?.type ?? null,
    assignedRoleName: activeAssignment?.sessionRole?.name ?? null,
    ...(canSeeJoinToken
      ? { joinToken: activeAssignment?.joinToken ?? null }
      : {}),
    roomUrl: activeAssignment
      ? accountMode
        ? buildAccountSessionRoomPath(activeAssignment.sessionId)
        : buildSessionRoomPath(activeAssignment.sessionId, activeAssignment.joinToken)
      : null,
    materialsUrl: activeAssignment
      ? accountMode
        ? buildAccountSessionMaterialsPath(activeAssignment.sessionId)
        : buildSessionMaterialsPath(activeAssignment.joinToken)
      : null,
    activeAssignmentLabel: assignmentLabel,
  };
}

function mapEventSession({
  session,
  isHost,
  currentParticipantId,
  accountMode,
}: {
  session: {
    id: string;
    title: string;
    roomLabel: string | null;
    sequenceNumber: number | null;
    snapshotCaseTitle: string;
    snapshotCaseLanguage: string;
    status: string;
    negotiationState: string;
    preparationDurationSeconds: number;
    durationSeconds: number;
    createdAt: Date;
    closeReason: string | null;
    closedByEventAt: Date | null;
    deletedAt: Date | null;
    recording: { status: string } | null;
    participants: Array<
      SessionParticipant & {
        sessionRole: { name: string } | null;
      }
    >;
  };
  isHost: boolean;
  currentParticipantId: string | null;
  accountMode: boolean;
}): EventStateSession {
  const facilitator = session.participants.find(
    (participant) => participant.type === "FACILITATOR",
  );
  const currentParticipant = currentParticipantId
    ? session.participants.find(
        (participant) => participant.eventParticipantId === currentParticipantId,
      )
    : null;
  const linkParticipant = isHost ? facilitator ?? session.participants[0] : currentParticipant;
  const isActive = isSessionActiveForAssignment(session);
  const isFinished = !isActive;
  const canOpenMaterials = Boolean(isHost || currentParticipant);

  return {
    id: session.id,
    title: session.title,
    roomLabel: session.roomLabel,
    sequenceNumber: session.sequenceNumber,
    caseTitle: session.snapshotCaseTitle,
    caseLanguage: session.snapshotCaseLanguage,
    status: session.status,
    negotiationState: session.negotiationState,
    preparationDuration: session.preparationDurationSeconds,
    negotiationDuration: session.durationSeconds,
    participantCount: session.participants.filter(
      (participant) => participant.type === "PARTICIPANT",
    ).length,
    observerCount: session.participants.filter(
      (participant) => participant.type === "OBSERVER",
    ).length,
    facilitatorName: facilitator?.displayName ?? null,
    isActive,
    isFinished,
    roomUrl:
      isActive && linkParticipant
        ? accountMode
          ? buildAccountSessionRoomPath(session.id)
          : buildSessionRoomPath(session.id, linkParticipant.joinToken)
        : null,
    materialsUrl: canOpenMaterials
      ? isHost
        ? accountMode
          ? buildAccountSessionMaterialsPath(session.id)
          : `/sessions/${session.id}`
        : currentParticipant
          ? accountMode
            ? buildAccountSessionMaterialsPath(session.id)
            : buildSessionMaterialsPath(currentParticipant.joinToken)
          : null
      : null,
    createdAt: session.createdAt.toISOString(),
    recordingStatus: session.recording?.status ?? null,
    closeReason: session.closeReason,
    closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
    participants: session.participants.map((participant) => {
      const canSeeLink = isHost || participant.eventParticipantId === currentParticipantId;

      return {
        id: participant.id,
        eventParticipantId: participant.eventParticipantId,
        displayName: participant.displayName,
        participantType: participant.type,
        roleName: participant.sessionRole?.name ?? null,
        roomUrl:
          isActive && canSeeLink
            ? accountMode
              ? buildAccountSessionRoomPath(session.id)
              : buildSessionRoomPath(session.id, participant.joinToken)
            : null,
        materialsUrl: canSeeLink
          ? accountMode
            ? buildAccountSessionMaterialsPath(session.id)
            : buildSessionMaterialsPath(participant.joinToken)
          : null,
      };
    }),
  };
}
